import { MODULE_ID, suggestDefaultQueue, suggestForActor, computeActionEconomy, getActorActions } from "./constants.mjs";
import { ActionQueueApp } from "./ActionQueueApp.mjs";
import { HudApp, registerHudSettings } from "./HudApp.mjs";
import { fireQueue, executeItem } from "./executor.mjs";
import {
  getQueue,
  addItem,
  updateItem,
  removeItem,
  reorderQueue,
  clearQueue,
  setItemStatus
} from "./queue-store.mjs";

let app = null;
let hud = null;

function openApp({ combatantId } = {}) {
  if (!app) app = new ActionQueueApp();
  if (combatantId) app.selectedHolderId = combatantId;
  app.render(true);
}

function openHud() {
  if (!hud) hud = new HudApp();
  hud.render(true);
}

function closeHud() {
  if (hud?.rendered) hud.close();
  hud = null;
}

function toggleHud() {
  if (hud?.rendered) closeHud();
  else openHud();
}

async function fireAction(holder, actionId, payload = {}) {
  if (!holder || !actionId) return false;
  const item = { id: foundry.utils.randomID(), actionId, payload, status: "pending" };
  const result = await executeItem(holder, item);
  if (result !== false) {
    if (holder.setFlag) await addItem(holder, { ...item, status: "fired" });
    return true;
  }
  return false;
}

function addSceneControlButton(controls) {
  const tokenControl = controls.find(c => c.name === "token");
  if (!tokenControl) return;
  tokenControl.tools.push({
    name: "lancer-action-queue",
    title: game.i18n.localize("ACTIONQUEUE.Title"),
    icon: "fas fa-list-ol",
    button: true,
    onClick: () => openApp()
  });
  tokenControl.tools.push({
    name: "lancer-action-hud",
    title: "LANCER Action HUD",
    icon: "fas fa-th",
    button: true,
    onClick: () => toggleHud()
  });
}

/**
 * Inject a small "Queue" button next to each combatant in the Combat Tracker.
 */
function decorateCombatTracker(_app, html) {
  const rows = html.find(".combatant");
  rows.each((_, row) => {
    if (row.querySelector(".aq-tracker-btn")) return;
    const combatantId = row.dataset.combatantId;
    if (!combatantId) return;
    const controls = row.querySelector(".combatant-controls");
    if (!controls) return;
    const btn = document.createElement("a");
    btn.className = "combatant-control aq-tracker-btn";
    btn.title = game.i18n.localize("ACTIONQUEUE.OpenButton");
    btn.innerHTML = '<i class="fas fa-list-ol"></i>';
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openApp({ combatantId });
    });
    controls.appendChild(btn);
  });
}

function onCombatantUpdate(combatant, changes) {
  const flagPath = `flags.${MODULE_ID}`;
  if (!foundry.utils.hasProperty(changes, flagPath)) return;
  if (app?.rendered) app.render(false);
  if (hud?.rendered) hud.render(false);
}

function onCombatChange() {
  if (app?.rendered) app.render(false);
  if (hud?.rendered) hud.render(false);
}

function onControlToken() {
  if (hud?.rendered) hud.render(false);
}

function onUpdateActor(actor) {
  if (!hud?.rendered) return;
  const token = canvas?.tokens?.controlled?.[0];
  if (token?.actor?.id === actor.id || game.user.character?.id === actor.id) {
    hud.render(false);
  }
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);
  registerHudSettings();

  game.modules.get(MODULE_ID).api = {
    open: openApp,
    openHud,
    closeHud,
    toggleHud,
    fireQueue,
    fireAction,
    getActorActions,
    suggestDefaultQueue,
    suggestForActor,
    computeActionEconomy,
    queue: {
      get: getQueue,
      add: addItem,
      update: updateItem,
      remove: removeItem,
      reorder: reorderQueue,
      clear: clearQueue,
      setStatus: setItemStatus
    }
  };
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);
});

Hooks.on("getSceneControlButtons", addSceneControlButton);
Hooks.on("renderCombatTracker", decorateCombatTracker);
Hooks.on("updateCombatant", onCombatantUpdate);
Hooks.on("createCombatant", onCombatChange);
Hooks.on("deleteCombatant", onCombatChange);
Hooks.on("updateCombat", onCombatChange);
Hooks.on("deleteCombat", onCombatChange);
Hooks.on("controlToken", onControlToken);
Hooks.on("updateActor", onUpdateActor);
Hooks.on("updateItem", (item) => {
  if (item.actor) onUpdateActor(item.actor);
});
