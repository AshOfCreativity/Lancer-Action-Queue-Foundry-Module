import {
  MODULE_ID,
  ACTION_CATALOG,
  ACTION_CATEGORIES,
  getActorActions,
  computeActionEconomy
} from "./constants.mjs";
import { executeItem } from "./executor.mjs";
import { getQueue, addItem } from "./queue-store.mjs";

const TEMPLATE = `modules/${MODULE_ID}/templates/action-hud.hbs`;

export const HUD_SETTINGS = {
  MACROS: "hudMacros",
  POSITION: "hudPosition",
  LOCKED: "hudLocked",
  COLLAPSED: "hudCollapsed"
};

const GROUP_DEFS = [
  { key: "weapons",   label: "Weapons",          match: a => a.isWeapon || a.isMount },
  { key: "systems",   label: "Systems & Gear",   match: a => a.id?.startsWith("system:") || a.id?.startsWith("gear:") },
  { key: "tech",      label: "Tech",             match: a => a.id?.startsWith("tech:") },
  { key: "reactions", label: "Reactions",        match: a => a.category === ACTION_CATEGORIES.REACTION || a.id?.startsWith("reaction:") },
  { key: "deployables", label: "Deployables",    match: a => a.id?.startsWith("deployable:") }
];

const STANDARD_GROUP_ORDER = [
  { key: "quick",    label: "Quick",    category: ACTION_CATEGORIES.QUICK },
  { key: "full",     label: "Full",     category: ACTION_CATEGORIES.FULL },
  { key: "protocol", label: "Protocol", category: ACTION_CATEGORIES.PROTOCOL },
  { key: "free",     label: "Free",     category: ACTION_CATEGORIES.FREE },
  { key: "other",    label: "Other",    category: ACTION_CATEGORIES.OTHER }
];

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

export class HudApp extends Application {
  constructor(options = {}) {
    super(options);
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

  getData() {
    const { token, actor } = resolveSelectedActor();
    if (!actor) {
      return { noActor: true, position: this._readPosition(), locked: this._isLocked(), collapsed: this._isCollapsed() };
    }

    const holder = resolveHolder(token, actor);
    const queue = holder?.getFlag ? getQueue(holder) : [];
    const economy = computeActionEconomy(queue, actor);

    const macros = this._readMacros()
      .map(id => game.macros.get(id))
      .filter(m => m != null)
      .map(m => ({ id: m.id, name: m.name, img: m.img || "icons/svg/dice-target.svg" }));

    const actorActions = getActorActions(actor);
    const groups = this._buildGroups(actorActions);
    const standard = this._buildStandardGroups();

    return {
      noActor: false,
      actorId: actor.id,
      actorName: actor.name,
      actorImg: actor.img || "icons/svg/mystery-man.svg",
      economy,
      macros,
      groups,
      standard,
      position: this._readPosition(),
      locked: this._isLocked(),
      collapsed: this._isCollapsed()
    };
  }

  _buildGroups(actorActions) {
    const unassigned = [...actorActions];
    const groups = [];
    for (const def of GROUP_DEFS) {
      const bucket = [];
      for (let i = unassigned.length - 1; i >= 0; i--) {
        if (def.match(unassigned[i])) {
          bucket.unshift(unassigned[i]);
          unassigned.splice(i, 1);
        }
      }
      if (bucket.length > 0) {
        groups.push({
          key: def.key,
          label: def.label,
          actions: bucket.map(a => this._actionButton(a))
        });
      }
    }
    if (unassigned.length > 0) {
      groups.push({
        key: "other",
        label: "Other",
        actions: unassigned.map(a => this._actionButton(a))
      });
    }
    return groups;
  }

  _actionButton(a) {
    return {
      actionId: a.id,
      label: a.name,
      icon: a.icon || "fas fa-cog",
      itemId: a.id?.includes(":") ? a.id.split(":")[1] : null
    };
  }

  _buildStandardGroups() {
    const out = [];
    for (const g of STANDARD_GROUP_ORDER) {
      const actions = ACTION_CATALOG
        .filter(a => a.category === g.category)
        .map(a => ({
          actionId: a.id,
          label: this._localizeAction(a.id),
          icon: a.icon
        }));
      if (actions.length === 0) continue;
      out.push({ key: g.key, label: g.label, actions });
    }
    return out;
  }

  _localizeAction(id) {
    const key = `ACTIONQUEUE.Actions.${id}`;
    const txt = game.i18n.localize(key);
    return txt === key ? id.replace(/\b\w/g, c => c.toUpperCase()) : txt;
  }

  _readMacros() {
    return game.settings.get(MODULE_ID, HUD_SETTINGS.MACROS) || [];
  }

  async _writeMacros(ids) {
    await game.settings.set(MODULE_ID, HUD_SETTINGS.MACROS, ids);
  }

  _readPosition() {
    return game.settings.get(MODULE_ID, HUD_SETTINGS.POSITION) || { x: 80, y: null, bottom: 80 };
  }

  async _writePosition(pos) {
    await game.settings.set(MODULE_ID, HUD_SETTINGS.POSITION, pos);
  }

  _isLocked() {
    return game.settings.get(MODULE_ID, HUD_SETTINGS.LOCKED) ?? true;
  }

  async _toggleLocked() {
    await game.settings.set(MODULE_ID, HUD_SETTINGS.LOCKED, !this._isLocked());
  }

  _isCollapsed() {
    return game.settings.get(MODULE_ID, HUD_SETTINGS.COLLAPSED) ?? false;
  }

  async _toggleCollapsed() {
    await game.settings.set(MODULE_ID, HUD_SETTINGS.COLLAPSED, !this._isCollapsed());
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Apply saved position to the floating container
    const el = html[0]?.closest("#lancer-action-hud") || html[0];
    if (el) {
      const pos = this._readPosition();
      if (pos.x != null) el.style.left = `${pos.x}px`;
      if (pos.y != null) { el.style.top = `${pos.y}px`; el.style.bottom = "auto"; }
      else if (pos.bottom != null) { el.style.bottom = `${pos.bottom}px`; el.style.top = "auto"; }
    }

    html.find(".ah-action").on("click", this._onClickAction.bind(this));
    html.find(".ah-action").on("contextmenu", this._onRightClickAction.bind(this));
    html.find(".ah-macro").on("click", this._onClickMacro.bind(this));
    html.find(".ah-macro-remove").on("click", this._onRemoveMacro.bind(this));
    html.find(".ah-lock").on("click", () => this._toggleLocked().then(() => this.render(false)));
    html.find(".ah-collapse").on("click", () => this._toggleCollapsed().then(() => this.render(false)));

    this._bindMacroDrop(html);
    this._bindDrag(html);
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
      const macroId = data.id || data.uuid?.split(".").pop();
      if (!macroId || !game.macros.get(macroId)) return;
      const macros = this._readMacros();
      if (macros.includes(macroId)) return;
      macros.push(macroId);
      await this._writeMacros(macros);
      this.render(false);
    });
  }

  _bindDrag(html) {
    if (this._isLocked()) return;
    const handle = html.find(".ah-header")[0];
    const container = html[0]?.closest("#lancer-action-hud") || html[0];
    if (!handle || !container) return;
    handle.style.cursor = "move";
    handle.addEventListener("mousedown", ev => {
      if (ev.target.closest("button")) return;
      ev.preventDefault();
      const rect = container.getBoundingClientRect();
      const offsetX = ev.clientX - rect.left;
      const offsetY = ev.clientY - rect.top;
      const onMove = e => {
        container.style.left = `${e.clientX - offsetX}px`;
        container.style.top = `${e.clientY - offsetY}px`;
        container.style.bottom = "auto";
      };
      const onUp = async e => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        await this._writePosition({ x: e.clientX - offsetX, y: e.clientY - offsetY, bottom: null });
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  async _onClickAction(ev) {
    ev.preventDefault();
    const btn = ev.currentTarget;
    const actionId = btn.dataset.actionId;
    const label = btn.dataset.label || actionId;
    const { token, actor } = resolveSelectedActor();
    if (!actor || !actionId) return;
    const holder = resolveHolder(token, actor);
    const payload = { itemName: label };

    if (ev.shiftKey && holder?.setFlag) {
      await addItem(holder, { actionId, payload, status: "pending" });
      ui.notifications.info(`Queued ${label}`);
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

  _onRightClickAction(ev) {
    ev.preventDefault();
    const btn = ev.currentTarget;
    const actionId = btn.dataset.actionId;
    if (!actionId?.includes(":")) return;
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
    macro.execute({ actor, token });
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
}

export function registerHudSettings() {
  game.settings.register(MODULE_ID, HUD_SETTINGS.MACROS, {
    scope: "client",
    config: false,
    type: Array,
    default: []
  });
  game.settings.register(MODULE_ID, HUD_SETTINGS.POSITION, {
    scope: "client",
    config: false,
    type: Object,
    default: { x: 80, y: null, bottom: 80 }
  });
  game.settings.register(MODULE_ID, HUD_SETTINGS.LOCKED, {
    scope: "client",
    config: false,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, HUD_SETTINGS.COLLAPSED, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });
}
