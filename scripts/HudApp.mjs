import {
  MODULE_ID,
  ACTION_CATALOG,
  ACTION_CATEGORIES,
  ACTION_COST,
  getActorActions,
  computeActionEconomy,
  suggestForActor
} from "./constants.mjs";
import { executeItem } from "./executor.mjs";
import { getQueue, addItem, setItemStatus, clearQueue } from "./queue-store.mjs";

const TEMPLATE = `modules/${MODULE_ID}/templates/action-hud.hbs`;

export const HUD_SETTINGS = {
  MACROS: "hudMacros",
  POSITION: "hudPosition",
  LOCKED: "hudLocked",
  COLLAPSED: "hudCollapsed",
  GROUPS_COLLAPSED: "hudGroupsCollapsed"
};

/**
 * Logical groupings for actor-derived actions.
 * The order here is the render order.
 */
const GROUP_DEFS = [
  {
    key: "weapons",
    label: "Weapons",
    icon: "fas fa-crosshairs",
    match: a => a.isWeapon || a.isMount || a.id?.startsWith("weapon:") || a.id?.startsWith("mount:")
  },
  {
    key: "tech",
    label: "Tech",
    icon: "fas fa-wrench",
    match: a => a.id?.startsWith("tech:") || (a.isTech && !a.id?.startsWith("deployable:"))
  },
  {
    key: "systems",
    label: "Systems & Gear",
    icon: "fas fa-cog",
    match: a => a.id?.startsWith("system:") || a.id?.startsWith("gear:")
  },
  {
    key: "reactions",
    label: "Reactions",
    icon: "fas fa-bolt",
    match: a => a.id?.startsWith("reaction:") || a.category === ACTION_CATEGORIES.REACTION
  },
  {
    key: "deployables",
    label: "Deployables",
    icon: "fas fa-rocket",
    match: a => a.id?.startsWith("deployable:")
  }
];

const STANDARD_GROUPS = [
  { key: "quick",    label: "Quick",    category: ACTION_CATEGORIES.QUICK },
  { key: "full",     label: "Full",     category: ACTION_CATEGORIES.FULL },
  { key: "protocol", label: "Protocol", category: ACTION_CATEGORIES.PROTOCOL },
  { key: "free",     label: "Free",     category: ACTION_CATEGORIES.FREE },
  { key: "reaction", label: "Reaction", category: ACTION_CATEGORIES.REACTION },
  { key: "other",    label: "Other",    category: ACTION_CATEGORIES.OTHER }
];

const COST_LABEL = {
  [ACTION_COST.QUICK]:    "Q",
  [ACTION_COST.FULL]:     "F",
  [ACTION_COST.FREE]:     "FR",
  [ACTION_COST.REACTION]: "R",
  [ACTION_COST.PROTOCOL]: "P",
  [ACTION_COST.NONE]:     ""
};

function resolveSelectedActor() {
  const token = canvas?.tokens?.controlled?.[0];
  if (token?.actor) return { token, actor: token.actor };
  const assigned = game.user.character;
  if (assigned) return { token: null, actor: assigned };
  return { token: null, actor: null };
}

function resolveHolder(token, actor) {
  const combat = game.combat;
  if (combat && token) {
    const c = combat.combatants.find(cb => cb.tokenId === token.id);
    if (c) return c;
  }
  if (combat && actor) {
    const c = combat.combatants.find(cb => cb.actor?.id === actor.id);
    if (c) return c;
  }
  return actor;
}

/**
 * Floating, draggable Action HUD. AppV1 with popOut:false, mounted directly
 * on document.body so it does not fight Foundry's main UI tree.
 */
export class HudApp extends Application {
  constructor(options = {}) {
    super(options);
    this._dragging = false;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "lancer-action-hud",
      template: TEMPLATE,
      classes: ["lancer", "action-hud-app"],
      popOut: false,
      resizable: false
    });
  }

  /**
   * popOut:false normally injects into #ui-middle. We want a floating HUD on
   * the body root, so override the full render pipeline.
   */
  async _render(force = false, options = {}) {
    // Skip background re-renders while the user is dragging the window —
    // otherwise the drag targets a stale, detached element.
    if (this._dragging && !force) return;
    const data = await this.getData();
    const html = $(await renderTemplate(this.options.template, data));
    html.attr("id", this.options.id);

    const existing = document.getElementById(this.options.id);
    if (existing) existing.remove();

    document.body.appendChild(html[0]);
    this._element = html;
    this._state = Application.RENDER_STATES.RENDERED;
    this._applyPosition(html[0]);
    this.activateListeners(html);
    Hooks.callAll("renderHudApp", this, html, data);
  }

  async close(options = {}) {
    const el = document.getElementById(this.options.id);
    if (el) el.remove();
    this._element = null;
    this._state = Application.RENDER_STATES.CLOSED;
  }

  get rendered() {
    return this._state === Application.RENDER_STATES.RENDERED;
  }

  // -----------------------------------------------------------------------
  // Data
  // -----------------------------------------------------------------------

  getData() {
    const { token, actor } = resolveSelectedActor();
    const locked = this._isLocked();
    const collapsed = this._isCollapsed();

    if (!actor) {
      return {
        noActor: true,
        locked,
        collapsed,
        macros: this._readMacrosForDisplay()
      };
    }

    const holder = resolveHolder(token, actor);
    const queue = holder?.getFlag ? getQueue(holder) : [];
    const economy = computeActionEconomy(queue, actor);
    const nextPending = queue.find(i => i.status === "pending") || null;

    const actorActions = getActorActions(actor);
    this._actorActionsCache = actorActions;

    const groupCollapsed = this._readGroupsCollapsed();
    const groups = this._buildGroups(actorActions, groupCollapsed);
    const standard = this._buildStandardGroup(groupCollapsed);

    return {
      noActor: false,
      locked,
      collapsed,
      actorId: actor.id,
      actorName: actor.name,
      actorImg: actor.img || "icons/svg/mystery-man.svg",
      actorType: actor.type,
      economy,
      economyLine: this._formatEconomy(economy),
      hasPending: !!nextPending,
      pendingCount: queue.filter(i => i.status === "pending").length,
      macros: this._readMacrosForDisplay(),
      groups,
      standard
    };
  }

  _formatEconomy(economy) {
    const parts = [`${economy.pointsUsed}/${economy.totalBudget} AP`];
    if (economy.reactions)  parts.push(`${economy.reactions} R`);
    if (economy.protocols)  parts.push(`${economy.protocols} P`);
    if (economy.overcharges) parts.push(`+${economy.overcharges} OC`);
    return parts.join(" · ");
  }

  _buildGroups(actorActions, groupCollapsed) {
    const unassigned = [...actorActions];
    const out = [];
    for (const def of GROUP_DEFS) {
      const bucket = [];
      for (let i = unassigned.length - 1; i >= 0; i--) {
        if (def.match(unassigned[i])) {
          bucket.unshift(unassigned[i]);
          unassigned.splice(i, 1);
        }
      }
      if (bucket.length === 0) continue;
      out.push({
        key: def.key,
        label: def.label,
        icon: def.icon,
        count: bucket.length,
        collapsed: !!groupCollapsed[def.key],
        actions: bucket.map(a => this._actionButton(a))
      });
    }
    if (unassigned.length > 0) {
      out.push({
        key: "misc",
        label: "Other",
        icon: "fas fa-ellipsis-h",
        count: unassigned.length,
        collapsed: !!groupCollapsed.misc,
        actions: unassigned.map(a => this._actionButton(a))
      });
    }
    return out;
  }

  _actionButton(a) {
    const costKey = a.cost || ACTION_COST.QUICK;
    return {
      actionId: a.id,
      label: a.name,
      icon: a.icon || "fas fa-cog",
      cost: costKey,
      costLabel: COST_LABEL[costKey] ?? "",
      costClass: `ah-cost-${costKey}`,
      itemId: a.id?.includes(":") ? a.id.split(":")[1] : null,
      isAttack: !!a.isAttack
    };
  }

  _buildStandardGroup(groupCollapsed) {
    const costRows = [];
    for (const g of STANDARD_GROUPS) {
      const actions = ACTION_CATALOG
        .filter(a => a.category === g.category)
        .map(a => ({
          actionId: a.id,
          label: this._localizeAction(a.id),
          icon: a.icon,
          cost: a.cost,
          costLabel: COST_LABEL[a.cost] ?? "",
          costClass: `ah-cost-${a.cost}`,
          isAttack: !!a.isAttack
        }));
      if (actions.length === 0) continue;
      costRows.push({ key: g.key, label: g.label, actions });
    }
    return {
      key: "standard",
      label: "Standard Actions",
      icon: "fas fa-dice-d20",
      collapsed: !!groupCollapsed.standard,
      count: costRows.reduce((n, r) => n + r.actions.length, 0),
      rows: costRows
    };
  }

  _localizeAction(id) {
    const key = `ACTIONQUEUE.Actions.${id}`;
    const txt = game.i18n.localize(key);
    return txt === key ? id.replace(/\b\w/g, c => c.toUpperCase()) : txt;
  }

  _readMacrosForDisplay() {
    return this._readMacros()
      .map(id => game.macros.get(id))
      .filter(m => m != null)
      .map(m => ({
        id: m.id,
        name: m.name,
        img: m.img || "icons/svg/dice-target.svg"
      }));
  }

  // -----------------------------------------------------------------------
  // Settings I/O
  // -----------------------------------------------------------------------

  _readMacros() {
    const v = game.settings.get(MODULE_ID, HUD_SETTINGS.MACROS);
    return Array.isArray(v) ? v : [];
  }

  async _writeMacros(ids) {
    await game.settings.set(MODULE_ID, HUD_SETTINGS.MACROS, ids);
  }

  _readPosition() {
    const v = game.settings.get(MODULE_ID, HUD_SETTINGS.POSITION);
    if (v && typeof v === "object") return v;
    return { x: 80, y: null, bottom: 80 };
  }

  async _writePosition(pos) {
    await game.settings.set(MODULE_ID, HUD_SETTINGS.POSITION, pos);
  }

  _isLocked() {
    return !!game.settings.get(MODULE_ID, HUD_SETTINGS.LOCKED);
  }

  async _toggleLocked() {
    await game.settings.set(MODULE_ID, HUD_SETTINGS.LOCKED, !this._isLocked());
  }

  _isCollapsed() {
    return !!game.settings.get(MODULE_ID, HUD_SETTINGS.COLLAPSED);
  }

  async _toggleCollapsed() {
    await game.settings.set(MODULE_ID, HUD_SETTINGS.COLLAPSED, !this._isCollapsed());
  }

  _readGroupsCollapsed() {
    const v = game.settings.get(MODULE_ID, HUD_SETTINGS.GROUPS_COLLAPSED);
    return (v && typeof v === "object") ? v : {};
  }

  async _toggleGroupCollapsed(key) {
    const map = this._readGroupsCollapsed();
    map[key] = !map[key];
    await game.settings.set(MODULE_ID, HUD_SETTINGS.GROUPS_COLLAPSED, map);
  }

  // -----------------------------------------------------------------------
  // Positioning
  // -----------------------------------------------------------------------

  _applyPosition(el) {
    if (!el) return;
    const pos = this._readPosition();
    if (pos.x != null) el.style.left = `${Math.max(0, pos.x)}px`;
    if (pos.y != null) {
      el.style.top = `${Math.max(0, pos.y)}px`;
      el.style.bottom = "auto";
    } else if (pos.bottom != null) {
      el.style.bottom = `${Math.max(0, pos.bottom)}px`;
      el.style.top = "auto";
    }
  }

  // -----------------------------------------------------------------------
  // Listeners
  // -----------------------------------------------------------------------

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];

    html.find(".ah-portrait-link").on("click", this._onPortraitClick.bind(this));
    html.find(".ah-action").on("click", this._onClickAction.bind(this));
    html.find(".ah-action").on("contextmenu", this._onRightClickAction.bind(this));
    html.find(".ah-macro").on("click", this._onClickMacro.bind(this));
    html.find(".ah-macro").on("contextmenu", this._onRightClickMacro.bind(this));
    html.find(".ah-macro-remove").on("click", this._onRemoveMacro.bind(this));
    html.find(".ah-group-header").on("click", this._onToggleGroup.bind(this));
    html.find(".ah-fire-next").on("click", this._onFireNext.bind(this));
    html.find(".ah-auto-suggest").on("click", this._onAutoSuggest.bind(this));
    html.find(".ah-open-queue").on("click", this._onOpenQueue.bind(this));
    html.find(".ah-lock").on("click", async () => { await this._toggleLocked(); this.render(false); });
    html.find(".ah-collapse").on("click", async () => { await this._toggleCollapsed(); this.render(false); });

    this._bindMacroDrop(html);
    this._bindDrag(root);
  }

  _bindMacroDrop(html) {
    const row = html.find(".ah-macros-row")[0];
    if (!row) return;
    row.addEventListener("dragover", ev => {
      ev.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", async ev => {
      ev.preventDefault();
      row.classList.remove("drag-over");
      let data;
      try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }
      if (data?.type !== "Macro") return;
      let macro = null;
      if (data.uuid) {
        try { macro = await fromUuid(data.uuid); } catch { /* ignore */ }
      }
      if (!macro && data.id) macro = game.macros.get(data.id);
      if (!macro) return;
      const macros = this._readMacros();
      if (macros.includes(macro.id)) return;
      macros.push(macro.id);
      await this._writeMacros(macros);
      this.render(false);
    });
  }

  _bindDrag(root) {
    if (!root || this._isLocked()) return;
    const handle = root.querySelector(".ah-drag-handle") || root.querySelector(".ah-header");
    if (!handle) return;
    handle.style.cursor = "move";
    handle.addEventListener("mousedown", ev => {
      if (ev.button !== 0) return;
      if (ev.target.closest("button, .ah-macro, .ah-action, .ah-portrait-link")) return;
      ev.preventDefault();
      const rect = root.getBoundingClientRect();
      const offsetX = ev.clientX - rect.left;
      const offsetY = ev.clientY - rect.top;
      this._dragging = true;
      root.classList.add("dragging");

      const onMove = e => {
        const maxLeft = window.innerWidth - 40;
        const maxTop = window.innerHeight - 24;
        const left = Math.min(maxLeft, Math.max(0, e.clientX - offsetX));
        const top  = Math.min(maxTop,  Math.max(0, e.clientY - offsetY));
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
        root.style.bottom = "auto";
      };
      const onUp = async e => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        root.classList.remove("dragging");
        this._dragging = false;
        const left = Math.min(window.innerWidth - 40, Math.max(0, e.clientX - offsetX));
        const top  = Math.min(window.innerHeight - 24, Math.max(0, e.clientY - offsetY));
        await this._writePosition({ x: left, y: top, bottom: null });
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  async _onToggleGroup(ev) {
    ev.preventDefault();
    const key = ev.currentTarget.dataset.groupKey;
    if (!key) return;
    await this._toggleGroupCollapsed(key);
    this.render(false);
  }

  async _onClickAction(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const btn = ev.currentTarget;
    const actionId = btn.dataset.actionId;
    const label = btn.dataset.label || actionId;
    const { token, actor } = resolveSelectedActor();
    if (!actor || !actionId) return;
    const holder = resolveHolder(token, actor);
    const payload = this._buildPayloadFor(actionId, label);

    if (ev.shiftKey && holder?.setFlag) {
      try {
        await addItem(holder, actionId, { payload });
        ui.notifications.info(`Queued ${label}`);
        this.render(false);
      } catch (err) {
        console.error(`${MODULE_ID} | queue add failed`, err);
        ui.notifications.error(`Queue failed: ${err?.message || err}`);
      }
      return;
    }

    const item = { id: foundry.utils.randomID(), actionId, payload, status: "pending" };
    try {
      await executeItem(holder || { actor }, item);
    } catch (err) {
      console.error(`${MODULE_ID} | HUD fire failed`, err);
      ui.notifications.error(`Action failed: ${err?.message || err}`);
    }
  }

  /**
   * Build a payload that mirrors what the palette path would set — so queued
   * items from the HUD look identical to ones added through ActionQueueApp.
   */
  _buildPayloadFor(actionId, label) {
    const payload = { itemName: label };
    if (!actionId.includes(":")) return payload;

    const cache = this._actorActionsCache || [];
    const def = cache.find(a => a.id === actionId);
    if (!def) return payload;

    payload.cost = def.cost;
    payload.isAttack = !!def.isAttack;
    payload.icon = def.icon;

    if (actionId.startsWith("mount:")) {
      payload.mountIndex = def.mountIndex;
    } else if (actionId.startsWith("deployable:")) {
      payload.actionIndex = def.actionIndex;
    } else if (def.itemId) {
      payload.itemId = def.itemId;
    }
    return payload;
  }

  _onRightClickAction(ev) {
    ev.preventDefault();
    const btn = ev.currentTarget;
    const actionId = btn.dataset.actionId;
    if (!actionId?.includes(":")) return;
    if (actionId.startsWith("mount:") || actionId.startsWith("deployable:")) return;
    const itemId = actionId.split(":")[1];
    const { actor } = resolveSelectedActor();
    const item = actor?.items?.get(itemId);
    item?.sheet?.render(true);
  }

  async _onClickMacro(ev) {
    ev.preventDefault();
    if (ev.target.closest(".ah-macro-remove")) return;
    const id = ev.currentTarget.dataset.macroId;
    const macro = game.macros.get(id);
    if (!macro) return;
    const { token, actor } = resolveSelectedActor();
    try {
      await macro.execute({ actor, token });
    } catch (err) {
      console.error(`${MODULE_ID} | macro execute failed`, err);
      ui.notifications.error(`Macro failed: ${err?.message || err}`);
    }
  }

  _onRightClickMacro(ev) {
    ev.preventDefault();
    const id = ev.currentTarget.dataset.macroId;
    const macro = game.macros.get(id);
    macro?.sheet?.render(true);
  }

  async _onRemoveMacro(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const id = ev.currentTarget.closest(".ah-macro")?.dataset?.macroId;
    if (!id) return;
    const macros = this._readMacros().filter(m => m !== id);
    await this._writeMacros(macros);
    this.render(false);
  }

  async _onFireNext(ev) {
    ev.preventDefault();
    const { token, actor } = resolveSelectedActor();
    if (!actor) return;
    const holder = resolveHolder(token, actor);
    if (!holder?.getFlag) {
      ui.notifications.warn("No combatant to fire from.");
      return;
    }
    const queue = getQueue(holder);
    const item = queue.find(i => i.status === "pending");
    if (!item) {
      ui.notifications.info("Queue is empty.");
      return;
    }
    try {
      const res = await executeItem(holder, item);
      if (res !== false && holder.setFlag) {
        await setItemStatus(holder, item.id, "fired");
      }
    } catch (err) {
      console.error(`${MODULE_ID} | fire next failed`, err);
      ui.notifications.error(`Fire failed: ${err?.message || err}`);
    }
  }

  _onOpenQueue(ev) {
    ev.preventDefault();
    const api = game.modules.get(MODULE_ID)?.api;
    api?.open?.();
  }

  _onPortraitClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const { actor } = resolveSelectedActor();
    actor?.sheet?.render(true);
  }

  /**
   * Fill the queue with a suggested turn for the controlled token's actor.
   * Confirms before replacing a queue that still has pending work.
   */
  async _onAutoSuggest(ev) {
    ev.preventDefault();
    const { token, actor } = resolveSelectedActor();
    if (!actor) {
      ui.notifications.warn("Select a token first.");
      return;
    }
    const holder = resolveHolder(token, actor);
    if (!holder?.setFlag) {
      ui.notifications.warn("Start combat before queueing suggestions.");
      return;
    }
    if (game.user.isGM === false && holder.actor?.isOwner !== true) {
      ui.notifications.warn("You do not have permission to edit this queue.");
      return;
    }

    const existing = getQueue(holder);
    const hasPending = existing.some(i => i.status === "pending");
    if (hasPending) {
      const confirmed = await Dialog.confirm({
        title: "Replace Queue?",
        content: "<p>This combatant already has pending actions queued. Replace them with a fresh suggestion?</p>"
      });
      if (!confirmed) return;
      await clearQueue(holder);
    }

    const items = suggestForActor(actor, {
      autoTarget: true,
      pickRecharges: true,
      includeProtocols: true,
      tierAccuracy: true,
      sourceToken: token ?? null
    });
    if (items.length === 0) {
      ui.notifications.info("No suggestions available for this actor's loadout.");
      return;
    }
    for (const it of items) {
      await addItem(holder, it.actionId, { payload: it.payload, notes: it.notes ?? "" });
    }
    const targeted = items.filter(i => i.payload?.targetIds?.length).length;
    ui.notifications.info(`Suggested ${items.length} action(s)${targeted ? `, ${targeted} auto-targeted` : ""}.`);
    this.render(false);
  }
}

export function registerHudSettings() {
  game.settings.register(MODULE_ID, HUD_SETTINGS.MACROS, {
    scope: "client", config: false, type: Array, default: []
  });
  game.settings.register(MODULE_ID, HUD_SETTINGS.POSITION, {
    scope: "client", config: false, type: Object, default: { x: 80, y: null, bottom: 80 }
  });
  game.settings.register(MODULE_ID, HUD_SETTINGS.LOCKED, {
    scope: "client", config: false, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, HUD_SETTINGS.COLLAPSED, {
    scope: "client", config: false, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, HUD_SETTINGS.GROUPS_COLLAPSED, {
    scope: "client", config: false, type: Object, default: {}
  });
}
