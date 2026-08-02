import { MODULE_ID } from "./constants.mjs";
import { ActionQueueApp } from "./ActionQueueApp.mjs";
import { fireQueue } from "./executor.mjs";
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

function openApp({ combatantId } = {}) {
  if (!app) app = new ActionQueueApp();
  if (combatantId) app.selectedHolderId = combatantId;
  app.render(true);
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

/** Re-render the open app when a combatant's queue flag changes. */
function onCombatantUpdate(combatant, changes) {
  const flagPath = `flags.${MODULE_ID}`;
  if (!foundry.utils.hasProperty(changes, flagPath)) return;
  if (app?.rendered) app.render(false);
}

function onCombatChange() {
  if (app?.rendered) app.render(false);
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);

  game.modules.get(MODULE_ID).api = {
    open: openApp,
    fireQueue,
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
