import { MODULE_ID, ACTION_CATALOG, ACTION_CATEGORIES, QUEUE_ITEM_STATUS, getActionDef } from "./constants.mjs";
import {
  getQueue,
  addItem,
  updateItem,
  removeItem,
  reorderQueue,
  clearQueue,
  setItemStatus
} from "./queue-store.mjs";
import { fireQueue } from "./executor.mjs";

function escHTML(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Resolve the holder doc (Combatant) the queue lives on, given a holderId.
 * Returns null if combat is gone or the combatant no longer exists.
 */
function resolveHolder(holderId) {
  if (!holderId) return null;
  const combat = game.combat;
  if (!combat) return null;
  return combat.combatants.get(holderId) ?? null;
}

function localizeAction(actionId) {
  return game.i18n.localize(`ACTIONQUEUE.Actions.${actionId}`);
}

function canEditCombatant(combatant) {
  if (!combatant) return false;
  if (game.user.isGM) return true;
  return combatant.actor?.isOwner === true;
}

export class ActionQueueApp extends Application {
  constructor(options = {}) {
    super(options);
    this.selectedHolderId = null;
    this.filterCategory = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "lancer-action-queue-app",
      title: game.i18n?.localize("ACTIONQUEUE.Title") ?? "Action Queue",
      template: `modules/${MODULE_ID}/templates/action-queue-app.hbs`,
      classes: ["lancer", "action-queue-app"],
      width: 980,
      height: 620,
      resizable: true,
      minimizable: true
    });
  }

  /** Auto-select the active combatant on first open if nothing is selected. */
  _autoSelect() {
    if (this.selectedHolderId) return;
    const combat = game.combat;
    if (!combat) return;
    const visible = this._visibleCombatants(combat);
    if (visible.length === 0) return;
    const active = combat.combatant;
    if (active && visible.some(c => c.id === active.id)) {
      this.selectedHolderId = active.id;
    } else {
      this.selectedHolderId = visible[0].id;
    }
  }

  _visibleCombatants(combat) {
    if (!combat) return [];
    const all = combat.combatants.contents;
    if (game.user.isGM) return all;
    return all.filter(c => c.actor?.isOwner === true);
  }

  async getData(options = {}) {
    const context = await super.getData(options);
    const combat = game.combat;

    this._autoSelect();

    const visible = this._visibleCombatants(combat);

    // Group combatants by section: players, npcs, defeated.
    const sections = {
      player: { id: "player", label: game.i18n.localize("ACTIONQUEUE.Combatants.PlayerSection"), items: [] },
      npc: { id: "npc", label: game.i18n.localize("ACTIONQUEUE.Combatants.NPCSection"), items: [] },
      defeated: { id: "defeated", label: game.i18n.localize("ACTIONQUEUE.Combatants.DefeatedSection"), items: [] }
    };

    for (const c of visible) {
      const actor = c.actor;
      const queue = getQueue(c);
      const entry = {
        id: c.id,
        name: c.name,
        img: c.img ?? actor?.img ?? "icons/svg/mystery-man.svg",
        defeated: c.isDefeated === true,
        isPlayer: actor?.hasPlayerOwner === true,
        queueCount: queue.length,
        selected: c.id === this.selectedHolderId,
        active: combat?.combatant?.id === c.id
      };
      if (entry.defeated) sections.defeated.items.push(entry);
      else if (entry.isPlayer) sections.player.items.push(entry);
      else sections.npc.items.push(entry);
    }

    context.hasCombat = !!combat;
    context.combatantSections = Object.values(sections).filter(s => s.items.length > 0);

    // Selected combatant + its queue.
    const selected = resolveHolder(this.selectedHolderId);
    context.selectedCombatant = selected
      ? {
          id: selected.id,
          name: selected.name,
          img: selected.img ?? selected.actor?.img,
          canEdit: canEditCombatant(selected)
        }
      : null;

    const rawQueue = selected ? getQueue(selected) : [];
    context.queueItems = rawQueue.map((item, index) => {
      const def = getActionDef(item.actionId);
      return {
        ...item,
        index,
        actionName: item.payload?.customName?.trim()
          || (def ? localizeAction(item.actionId) : item.actionId),
        actionIcon: def?.icon ?? "fas fa-question",
        category: def?.category ?? ACTION_CATEGORIES.OTHER,
        statusLabel: game.i18n.localize(`ACTIONQUEUE.Queue.Status.${item.status}`),
        isAttack: !!def?.isAttack,
        isFired: item.status === QUEUE_ITEM_STATUS.FIRED,
        isPending: item.status === QUEUE_ITEM_STATUS.PENDING,
        metaPills: this._buildMetaPills(item, selected)
      };
    });
    context.queueIsEmpty = context.queueItems.length === 0;

    // Action palette (filtered by category).
    const filter = this.filterCategory;
    context.palette = ACTION_CATALOG
      .filter(def => !filter || def.category === filter)
      .map(def => ({
        id: def.id,
        name: localizeAction(def.id),
        category: def.category,
        icon: def.icon,
        isAttack: !!def.isAttack
      }));
    context.paletteEmpty = context.palette.length === 0;

    // Category filter buttons.
    context.categoryFilters = [
      { id: "all", label: game.i18n.localize("ACTIONQUEUE.Palette.Categories.all"), active: !filter },
      ...Object.values(ACTION_CATEGORIES).map(catId => ({
        id: catId,
        label: game.i18n.localize(`ACTIONQUEUE.Palette.Categories.${catId}`),
        active: filter === catId
      }))
    ];

    return context;
  }

  _buildMetaPills(item, holder) {
    const def = getActionDef(item.actionId);
    const pills = [];
    if (!def) return pills;
    if (def.isAttack) {
      const weaponName = this._weaponName(item.payload?.weaponId, holder);
      if (weaponName) pills.push({ label: weaponName });
      const targets = item.payload?.targetNames;
      if (Array.isArray(targets) && targets.length > 0) {
        pills.push({ label: `→ ${targets.join(", ")}` });
      }
      const acc = Number(item.payload?.accuracy ?? 0);
      const diff = Number(item.payload?.difficulty ?? 0);
      if (acc) pills.push({ label: `+${acc} acc` });
      if (diff) pills.push({ label: `+${diff} diff` });
    }
    return pills;
  }

  _weaponName(weaponId, holder) {
    if (!weaponId || !holder?.actor) return null;
    const item = holder.actor.items?.get(weaponId);
    return item?.name ?? null;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".aq-combatant").on("click", this._onSelectCombatant.bind(this));
    html.find(".aq-filter-btn").on("click", this._onFilterCategory.bind(this));
    html.find(".aq-action-card").on("click", this._onAddAction.bind(this));
    html.find(".aq-fire-btn").on("click", this._onFire.bind(this));
    html.find(".aq-clear-btn").on("click", this._onClear.bind(this));
    html.find(".aq-remove-item").on("click", this._onRemoveItem.bind(this));
    html.find(".aq-edit-item").on("click", this._onEditItem.bind(this));
    html.find(".aq-toggle-status").on("click", this._onToggleStatus.bind(this));
    html.find(".aq-move-up").on("click", this._onMove.bind(this, -1));
    html.find(".aq-move-down").on("click", this._onMove.bind(this, 1));

    this._initQueueDragDrop(html);
  }

  _onSelectCombatant(event) {
    event.preventDefault();
    const id = event.currentTarget.dataset.combatantId;
    if (!id) return;
    this.selectedHolderId = id;
    this.render(false);
  }

  _onFilterCategory(event) {
    event.preventDefault();
    const cat = event.currentTarget.dataset.category;
    this.filterCategory = cat === "all" ? null : cat;
    this.render(false);
  }

  async _onAddAction(event) {
    event.preventDefault();
    const actionId = event.currentTarget.dataset.actionId;
    const holder = resolveHolder(this.selectedHolderId);
    if (!holder) {
      ui.notifications.warn(game.i18n.localize("ACTIONQUEUE.Notifications.NoSelection"));
      return;
    }
    if (!canEditCombatant(holder)) {
      ui.notifications.warn(game.i18n.localize("ACTIONQUEUE.Notifications.PermissionDenied"));
      return;
    }
    const def = getActionDef(actionId);
    if (!def) return;

    const config = await this._showConfigDialog({ actionDef: def, holder });
    if (!config) return; // cancelled

    await addItem(holder, actionId, { payload: config.payload, notes: config.notes });
    ui.notifications.info(game.i18n.format("ACTIONQUEUE.Notifications.ItemAdded", {
      action: localizeAction(actionId)
    }));
    this.render(false);
  }

  async _onEditItem(event) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = event.currentTarget.dataset.itemId;
    const holder = resolveHolder(this.selectedHolderId);
    if (!holder || !canEditCombatant(holder)) return;
    const queue = getQueue(holder);
    const item = queue.find(i => i.id === itemId);
    if (!item) return;
    const def = getActionDef(item.actionId);
    if (!def) return;

    const config = await this._showConfigDialog({ actionDef: def, holder, existing: item });
    if (!config) return;

    await updateItem(holder, itemId, { payload: config.payload, notes: config.notes });
    this.render(false);
  }

  async _onRemoveItem(event) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = event.currentTarget.dataset.itemId;
    const holder = resolveHolder(this.selectedHolderId);
    if (!holder || !canEditCombatant(holder)) return;
    await removeItem(holder, itemId);
    this.render(false);
  }

  async _onToggleStatus(event) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = event.currentTarget.dataset.itemId;
    const holder = resolveHolder(this.selectedHolderId);
    if (!holder || !canEditCombatant(holder)) return;
    const queue = getQueue(holder);
    const item = queue.find(i => i.id === itemId);
    if (!item) return;
    const next = item.status === QUEUE_ITEM_STATUS.PENDING
      ? QUEUE_ITEM_STATUS.FIRED
      : QUEUE_ITEM_STATUS.PENDING;
    await setItemStatus(holder, itemId, next);
    this.render(false);
  }

  async _onMove(delta, event) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = event.currentTarget.dataset.itemId;
    const holder = resolveHolder(this.selectedHolderId);
    if (!holder || !canEditCombatant(holder)) return;
    const queue = getQueue(holder);
    const idx = queue.findIndex(i => i.id === itemId);
    const target = idx + delta;
    if (idx === -1 || target < 0 || target >= queue.length) return;
    const ids = queue.map(i => i.id);
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    await reorderQueue(holder, ids);
    this.render(false);
  }

  async _onClear(event) {
    event.preventDefault();
    const holder = resolveHolder(this.selectedHolderId);
    if (!holder || !canEditCombatant(holder)) return;
    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("ACTIONQUEUE.Queue.Clear"),
      content: `<p>${game.i18n.localize("ACTIONQUEUE.Queue.Clear")}?</p>`
    });
    if (!confirmed) return;
    await clearQueue(holder);
    ui.notifications.info(game.i18n.localize("ACTIONQUEUE.Notifications.QueueCleared"));
    this.render(false);
  }

  async _onFire(event) {
    event.preventDefault();
    const holder = resolveHolder(this.selectedHolderId);
    if (!holder || !canEditCombatant(holder)) return;
    const queue = getQueue(holder);
    if (queue.length === 0) {
      ui.notifications.warn(game.i18n.localize("ACTIONQUEUE.Notifications.FireEmpty"));
      return;
    }
    const fired = await fireQueue(holder);
    ui.notifications.info(game.i18n.format("ACTIONQUEUE.Notifications.Fired", { count: fired }));
    this.render(false);
  }

  /**
   * Open a config dialog for an action. For attacks, shows weapon/target/acc/diff inputs.
   * For non-attacks, shows just notes (and a custom-name field for "custom" actions).
   * Returns { payload, notes } or null on cancel.
   */
  _showConfigDialog({ actionDef, holder, existing = null }) {
    return new Promise((resolve) => {
      const isAttack = !!actionDef.isAttack;
      const isCustom = actionDef.id === "custom";
      const existingPayload = existing?.payload ?? {};
      const weaponOptions = this._collectWeapons(holder);
      const selectedTokenNames = canvas.tokens?.controlled?.map(t => t.name) ?? [];
      const initialTargets = (existingPayload.targetNames ?? selectedTokenNames).join(", ");

      const weaponSelect = isAttack && weaponOptions.length > 0
        ? `<select name="weaponId">
             <option value="">${game.i18n.localize("ACTIONQUEUE.Config.Weapon")}…</option>
             ${weaponOptions.map(w => `
               <option value="${w.id}" ${w.id === existingPayload.weaponId ? "selected" : ""}>${escHTML(w.name)}</option>
             `).join("")}
           </select>`
        : isAttack
          ? `<em class="hint">${game.i18n.localize("ACTIONQUEUE.Config.NoWeapons")}</em>`
          : "";

      const customNameField = isCustom
        ? `<div class="form-group">
             <label>Action Name</label>
             <input type="text" name="customName" value="${escHTML(existingPayload.customName ?? "")}" placeholder="e.g., Ace Maneuver" />
           </div>`
        : "";

      const attackFields = isAttack
        ? `<div class="form-group">
             <label>${game.i18n.localize("ACTIONQUEUE.Config.Weapon")}</label>
             ${weaponSelect}
             <p class="hint">${game.i18n.localize("ACTIONQUEUE.Config.WeaponHint")}</p>
           </div>
           <div class="form-group">
             <label>${game.i18n.localize("ACTIONQUEUE.Config.Target")}</label>
             <input type="text" name="targets" value="${escHTML(initialTargets)}" placeholder="${game.i18n.localize("ACTIONQUEUE.Config.TargetHint")}" />
             <p class="hint">${game.i18n.localize("ACTIONQUEUE.Config.TargetHint")}</p>
           </div>
           <div class="form-row-pair">
             <div class="form-group">
               <label>${game.i18n.localize("ACTIONQUEUE.Config.Accuracy")}</label>
               <input type="number" name="accuracy" value="${existingPayload.accuracy ?? 0}" min="0" max="9" />
               <p class="hint">${game.i18n.localize("ACTIONQUEUE.Config.AccuracyHint")}</p>
             </div>
             <div class="form-group">
               <label>${game.i18n.localize("ACTIONQUEUE.Config.Difficulty")}</label>
               <input type="number" name="difficulty" value="${existingPayload.difficulty ?? 0}" min="0" max="9" />
               <p class="hint">${game.i18n.localize("ACTIONQUEUE.Config.DifficultyHint")}</p>
             </div>
           </div>`
        : "";

      const content = `
        <form class="aq-config-form">
          ${customNameField}
          ${attackFields}
          <div class="form-group">
            <label>${game.i18n.localize("ACTIONQUEUE.Config.Notes")}</label>
            <textarea name="notes" rows="2" placeholder="${game.i18n.localize("ACTIONQUEUE.Config.NotesPlaceholder")}">${escHTML(existing?.notes ?? "")}</textarea>
          </div>
        </form>
      `;

      const titleAction = isCustom && !existing
        ? game.i18n.localize("ACTIONQUEUE.Actions.custom")
        : localizeAction(actionDef.id);

      const saveLabel = existing
        ? game.i18n.localize("ACTIONQUEUE.Config.Update")
        : game.i18n.localize("ACTIONQUEUE.Config.Save");

      new Dialog({
        title: game.i18n.format("ACTIONQUEUE.Config.Title", { action: titleAction }),
        content,
        buttons: {
          save: {
            icon: '<i class="fas fa-check"></i>',
            label: saveLabel,
            callback: (html) => {
              const targets = html.find('[name="targets"]').val() ?? "";
              const targetNames = targets
                .split(",")
                .map(s => s.trim())
                .filter(Boolean);
              const payload = {};
              if (isCustom) payload.customName = html.find('[name="customName"]').val()?.trim() ?? "";
              if (isAttack) {
                payload.weaponId = html.find('[name="weaponId"]').val() || null;
                payload.targetNames = targetNames;
                payload.accuracy = Number(html.find('[name="accuracy"]').val() ?? 0) || 0;
                payload.difficulty = Number(html.find('[name="difficulty"]').val() ?? 0) || 0;
              }
              const notes = html.find('[name="notes"]').val()?.trim() ?? "";
              resolve({ payload, notes });
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("ACTIONQUEUE.Config.Cancel"),
            callback: () => resolve(null)
          }
        },
        default: "save",
        close: () => resolve(null)
      }).render(true);
    });
  }

  _collectWeapons(holder) {
    const actor = holder?.actor;
    if (!actor?.items) return [];
    // LANCER weapon item types include: mech_weapon, pilot_weapon, npc_feature (with type=weapon).
    return actor.items
      .filter(i => {
        if (i.type === "mech_weapon" || i.type === "pilot_weapon") return true;
        if (i.type === "npc_feature" && i.system?.type?.toLowerCase?.() === "weapon") return true;
        return false;
      })
      .map(i => ({ id: i.id, name: i.name }));
  }

  _initQueueDragDrop(html) {
    const items = html.find(".aq-queue-item");
    let draggedId = null;

    items.each((_, el) => {
      el.addEventListener("dragstart", (e) => {
        draggedId = el.dataset.itemId;
        el.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", draggedId);
      });

      el.addEventListener("dragend", () => {
        draggedId = null;
        items.each((_, n) => n.classList.remove("dragging", "drag-over-top", "drag-over-bottom"));
      });

      el.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (el.dataset.itemId === draggedId) return;
        const rect = el.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        el.classList.remove("drag-over-top", "drag-over-bottom");
        el.classList.add(e.clientY < midY ? "drag-over-top" : "drag-over-bottom");
      });

      el.addEventListener("dragleave", () => {
        el.classList.remove("drag-over-top", "drag-over-bottom");
      });

      el.addEventListener("drop", async (e) => {
        e.preventDefault();
        const droppedId = e.dataTransfer.getData("text/plain");
        const targetId = el.dataset.itemId;
        if (!droppedId || droppedId === targetId) return;

        const holder = resolveHolder(this.selectedHolderId);
        if (!holder || !canEditCombatant(holder)) return;
        const queue = getQueue(holder);
        const ids = queue.map(i => i.id);
        const fromIndex = ids.indexOf(droppedId);
        if (fromIndex === -1) return;
        ids.splice(fromIndex, 1);
        const toIndex = ids.indexOf(targetId);
        const rect = el.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertAt = e.clientY < midY ? toIndex : toIndex + 1;
        ids.splice(insertAt, 0, droppedId);
        await reorderQueue(holder, ids);
        this.render(false);
      });
    });
  }
}
