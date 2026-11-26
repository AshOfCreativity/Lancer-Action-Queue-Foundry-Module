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

const CATEGORY_DEFS = [
  { key: "weapons",     label: "Weapons",         icon: "fas fa-crosshairs",   match: a => a.isWeapon || a.isMount },
  { key: "tech",        label: "Tech",            icon: "fas fa-wrench",       match: a => a.id?.startsWith("tech:") },
  { key: "systems",     label: "Systems",         icon: "fas fa-microchip",    match: a => a.id?.startsWith("system:") || a.id?.startsWith("gear:") },
  { key: "reactions",   label: "Reactions",       icon: "fas fa-bolt",         match: a => a.category === ACTION_CATEGORIES.REACTION || a.id?.startsWith("reaction:") },
  { key: "deployables", label: "Deployables",     icon: "fas fa-rocket",       match: a => a.id?.startsWith("deployable:") }
];

const STANDARD_SECTIONS = [
  { key: "quick",    label: "Quick",    category: ACTION_CATEGORIES.QUICK },
  { key: "full",     label: "Full",     category: ACTION_CATEGORIES.FULL },
  { key: "protocol", label: "Protocol", category: ACTION_CATEGORIES.PROTOCOL },
  { key: "reaction", label: "Reaction", category: ACTION_CATEGORIES.REACTION },
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
    this._openCategory = null;
    this._docClickHandler = null;
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

  async _render(force = false, options = {}) {
    const data = await this.getData();
    const html = $(await renderTemplate(this.options.template, data));
    html.attr("id", this.options.id);

    const existing = document.getElementById(this.options.id);
    if (existing) existing.remove();

    this._unbindDocClick();
    document.body.appendChild(html[0]);
    this._element = html;
    this._state = Application.RENDER_STATES.RENDERED;
    this.activateListeners(html);
    Hooks.callAll("renderHudApp", this, html, data);
  }

  async close(options = {}) {
    this._unbindDocClick();
    const el = document.getElementById(this.options.id);
    if (el) el.remove();
    this._element = null;
    this._state = Application.RENDER_STATES.CLOSED;
    this._openCategory = null;
  }

  get rendered() {
    return this._state === Application.RENDER_STATES.RENDERED;
  }

  getData() {
    const { token, actor } = resolveSelectedActor();
    if (!actor) {
      return {
        noActor: true,
        macros: this._getMacroData(),
        position: this._readPosition(),
        locked: this._isLocked(),
        collapsed: this._isCollapsed()
      };
    }

    const holder = resolveHolder(token, actor);
    const queue = holder?.getFlag ? getQueue(holder) : [];
    const economy = computeActionEconomy(queue, actor);
    const pending = queue.filter(i => i.status === "pending");

    const actorActions = getActorActions(actor);
    const categories = this._buildCategories(actorActions);
    const standard = this._buildStandardSections();
    categories.push({
      key: "actions",
      label: "Actions",
      icon: "fas fa-dice-d20",
      count: standard.reduce((n, s) => n + s.actions.length, 0),
      sections: standard,
      isStandard: true
    });

    let openCategory = null;
    if (this._openCategory) {
      openCategory = categories.find(c => c.key === this._openCategory) || null;
    }
    const filteredCats = categories.filter(c => c.count > 0);
    for (const c of filteredCats) {
      c.openClass = (openCategory && c.key === openCategory.key) ? "ah-chip-open" : "";
    }

    return {
      noActor: false,
      actorId: actor.id,
      actorName: actor.name,
      actorImg: actor.img || "icons/svg/mystery-man.svg",
      economy,
      economyLine: `${economy.pointsUsed}/${economy.totalBudget}`,
      pendingCount: pending.length,
      hasPending: pending.length > 0,
      macros: this._getMacroData(),
      categories: filteredCats,
      openCategory,
      position: this._readPosition(),
      locked: this._isLocked(),
      collapsed: this._isCollapsed()
    };
  }

  _getMacroData() {
    return this._readMacros()
      .map(id => game.macros.get(id))
      .filter(m => m != null)
      .map(m => ({ id: m.id, name: m.name, img: m.img || "icons/svg/dice-target.svg" }));
  }

  _buildCategories(actorActions) {
    const unassigned = [...actorActions];
    const out = [];
    for (const def of CATEGORY_DEFS) {
      const bucket = [];
      for (let i = unassigned.length - 1; i >= 0; i--) {
        if (def.match(unassigned[i])) {
          bucket.unshift(unassigned[i]);
          unassigned.splice(i, 1);
        }
      }
      out.push({
        key: def.key,
        label: def.label,
        icon: def.icon,
        count: bucket.length,
        actions: bucket.map(a => this._actionButton(a))
      });
    }
    if (unassigned.length > 0) {
      out.push({
        key: "other-actor",
        label: "Other",
        icon: "fas fa-cog",
        count: unassigned.length,
        actions: unassigned.map(a => this._actionButton(a))
      });
    }
    return out;
  }

  _actionButton(a) {
    return {
      actionId: a.id,
      label: a.name,
      icon: a.icon || "fas fa-cog",
      itemId: a.id?.includes(":") ? a.id.split(":")[1] : null
    };
  }

  _buildStandardSections() {
    const out = [];
    for (const section of STANDARD_SECTIONS) {
      const actions = ACTION_CATALOG
        .filter(a => a.category === section.category)
        .map(a => ({
          actionId: a.id,
          label: this._localizeAction(a.id),
          icon: a.icon
        }));
      if (actions.length === 0) continue;
      out.push({ key: section.key, label: section.label, actions });
    }
    return out;
  }

  _localizeAction(id) {
    const key = `ACTIONQUEUE.Actions.${id}`;
    const txt = game.i18n.localize(key);
    return txt === key ? id.replace(/\b\w/g, c => c.toUpperCase()) : txt;
  }

  _readMacros() { return game.settings.get(MODULE_ID, HUD_SETTINGS.MACROS) || []; }
  async _writeMacros(ids) { await game.settings.set(MODULE_ID, HUD_SETTINGS.MACROS, ids); }
  _readPosition() { return game.settings.get(MODULE_ID, HUD_SETTINGS.POSITION) || { x: 80, y: null, bottom: 80 }; }
  async _writePosition(pos) { await game.settings.set(MODULE_ID, HUD_SETTINGS.POSITION, pos); }
  _isLocked() { return game.settings.get(MODULE_ID, HUD_SETTINGS.LOCKED) ?? false; }
  async _toggleLocked() { await game.settings.set(MODULE_ID, HUD_SETTINGS.LOCKED, !this._isLocked()); }
  _isCollapsed() { return game.settings.get(MODULE_ID, HUD_SETTINGS.COLLAPSED) ?? false; }
  async _toggleCollapsed() { await game.settings.set(MODULE_ID, HUD_SETTINGS.COLLAPSED, !this._isCollapsed()); }

  activateListeners(html) {
    super.activateListeners(html);

    const root = html[0];
    if (root) {
      const pos = this._readPosition();
      if (pos.x != null) root.style.left = `${pos.x}px`;
      if (pos.y != null) { root.style.top = `${pos.y}px`; root.style.bottom = "auto"; }
      else if (pos.bottom != null) { root.style.bottom = `${pos.bottom}px`; root.style.top = "auto"; }
    }

    html.find(".ah-chip").on("click", this._onToggleCategory.bind(this));
    html.find(".ah-action").on("click", this._onClickAction.bind(this));
    html.find(".ah-action").on("contextmenu", this._onRightClickAction.bind(this));
    html.find(".ah-macro").on("click", this._onClickMacro.bind(this));
    html.find(".ah-macro-remove").on("click", this._onRemoveMacro.bind(this));
    html.find(".ah-lock").on("click", () => this._toggleLocked().then(() => this.render(false)));
    html.find(".ah-collapse").on("click", () => this._toggleCollapsed().then(() => this.render(false)));
    html.find(".ah-close").on("click", () => this.close());

    this._bindMacroDrop(html);
    this._bindDrag(html);
    if (this._openCategory) this._bindDocClick();
  }

  _bindDocClick() {
    this._unbindDocClick();
    this._docClickHandler = ev => {
      if (!this._element) return;
      if (this._element[0].contains(ev.target)) return;
      this._openCategory = null;
      this.render(false);
    };
    setTimeout(() => document.addEventListener("mousedown", this._docClickHandler), 0);
  }

  _unbindDocClick() {
    if (this._docClickHandler) {
      document.removeEventListener("mousedown", this._docClickHandler);
      this._docClickHandler = null;
    }
  }

  _onToggleCategory(ev) {
    ev.preventDefault();
    const key = ev.currentTarget.dataset.cat;
    this._openCategory = this._openCategory === key ? null : key;
    this.render(false);
  }

  _bindMacroDrop(html) {
    const row = html.find(".ah-macros")[0];
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
    const handle = html.find(".ah-drag")[0];
    const container = html[0];
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
      this._openCategory = null;
      this.render(false);
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
    default: false
  });
  game.settings.register(MODULE_ID, HUD_SETTINGS.COLLAPSED, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });
}
