import { MODULE_ID, QUEUE_ITEM_STATUS, getActionDef } from "./constants.mjs";
import { getQueue, setItemStatus } from "./queue-store.mjs";

/**
 * Fire every PENDING item in the holder's queue, in order.
 * Hands off to LANCER's native flows for attacks.
 * Returns the number of items actually fired.
 */
export async function fireQueue(holder) {
  if (!holder) return 0;
  const queue = getQueue(holder);
  let fired = 0;
  for (const item of queue) {
    if (item.status !== QUEUE_ITEM_STATUS.PENDING) continue;
    const success = await executeItem(holder, item);
    if (success !== false) {
      await setItemStatus(holder, item.id, QUEUE_ITEM_STATUS.FIRED);
      fired += 1;
    }
  }
  return fired;
}

/**
 * Execute a single queued action by dispatching to the right LANCER flow.
 * Returns false if the user cancelled or the flow was aborted.
 */
async function executeItem(holder, item) {
  const actor = holder.actor;
  if (!actor) {
    postFallbackCard(holder, item, "No actor linked to combatant");
    return false;
  }

  const actionId = item.actionId;

  // Direct weapon/tech/system fire via item reference
  if (actionId.startsWith("weapon:") || actionId.startsWith("tech:") || actionId.startsWith("system:") || actionId.startsWith("reaction:")) {
    return await executeItemAction(actor, item);
  }

  // Weapon-based standard actions (skirmish, barrage, overwatch)
  if (actionId === "skirmish" || actionId === "barrage" || actionId === "overwatch") {
    return await executeWeaponAction(actor, item);
  }

  // Attack actions that use BasicAttackFlow
  if (actionId === "improvised" || actionId === "ram" || actionId === "grapple") {
    return await executeBasicAttack(actor, item);
  }

  // Tech actions
  if (actionId === "quick-tech" || actionId === "full-tech") {
    if (typeof actor.beginBasicTechAttackFlow === "function") {
      return await actor.beginBasicTechAttackFlow();
    }
    postFallbackCard(holder, item);
    return true;
  }

  // Stabilize
  if (actionId === "stabilize") {
    if (typeof actor.beginStabilizeFlow === "function") {
      return await actor.beginStabilizeFlow();
    }
    postFallbackCard(holder, item);
    return true;
  }

  // Overcharge
  if (actionId === "overcharge") {
    if (typeof actor.beginOverchargeFlow === "function") {
      return await actor.beginOverchargeFlow();
    }
    postFallbackCard(holder, item);
    return true;
  }

  // Everything else (boost, hide, search, disengage, brace, protocol, custom): chat card
  postFallbackCard(holder, item);
  return true;
}

/**
 * Fire a weapon/tech/system item directly using LANCER's item flow.
 */
async function executeItemAction(actor, queueItem) {
  const itemId = queueItem.payload?.itemId || queueItem.actionId.split(":")[1];
  const item = actor.items.get(itemId);

  if (!item) {
    ui.notifications.warn(`Item not found on ${actor.name} — it may have been removed.`);
    return false;
  }

  if (item.type === "mech_weapon" || item.type === "pilot_weapon" ||
      (item.type === "npc_feature" && item.system?.type?.toLowerCase?.() === "weapon")) {
    if (typeof item.beginWeaponAttackFlow === "function") {
      return await item.beginWeaponAttackFlow();
    }
  }

  if (item.type === "npc_feature" && item.system?.type?.toLowerCase?.() === "tech") {
    if (typeof item.beginTechAttackFlow === "function") {
      return await item.beginTechAttackFlow();
    }
  }

  // Systems/traits/reactions — use the system flow if available
  if (typeof item.beginSystemFlow === "function") {
    return await item.beginSystemFlow();
  }

  // Fallback: just post the item to chat
  if (typeof item.beginDefaultFlow === "function") {
    return await item.beginDefaultFlow();
  }

  return true;
}

/**
 * Execute a standard weapon action (skirmish/barrage/overwatch).
 * If a weapon was selected in the config, use it directly.
 * Otherwise trigger LANCER's basic attack flow.
 */
async function executeWeaponAction(actor, queueItem) {
  const weaponId = queueItem.payload?.weaponId;

  if (weaponId) {
    const weapon = actor.items.get(weaponId);
    if (weapon && typeof weapon.beginWeaponAttackFlow === "function") {
      return await weapon.beginWeaponAttackFlow();
    }
    ui.notifications.warn(`Weapon not found on ${actor.name}.`);
  }

  if (typeof actor.beginBasicAttackFlow === "function") {
    return await actor.beginBasicAttackFlow(queueItem.actionId);
  }

  return false;
}

/**
 * Execute a basic (non-weapon) attack: improvised, ram, grapple.
 */
async function executeBasicAttack(actor, queueItem) {
  const def = getActionDef(queueItem.actionId);
  const title = def ? game.i18n.localize(`ACTIONQUEUE.Actions.${queueItem.actionId}`) : queueItem.actionId;

  if (typeof actor.beginBasicAttackFlow === "function") {
    return await actor.beginBasicAttackFlow(title);
  }

  return false;
}

/**
 * Fallback: post a chat card for actions without a dedicated flow.
 */
function postFallbackCard(holder, item, error) {
  const def = getActionDef(item.actionId);
  const actionName = item.payload?.customName?.trim()
    || (def ? game.i18n.localize(`ACTIONQUEUE.Actions.${item.actionId}`) : item.actionId);

  const lines = [`<strong>${escape(actionName)}</strong>`];
  if (error) lines.push(`<em style="color:#e74c3c">${escape(error)}</em>`);
  if (item.notes) lines.push(`<em>${escape(item.notes)}</em>`);

  const speaker = holder.actor
    ? ChatMessage.getSpeaker({ actor: holder.actor })
    : ChatMessage.getSpeaker();

  ChatMessage.create({
    speaker,
    content: `<div class="lancer-action-queue-card"><div class="aq-card-tag">[Action]</div>${lines.join("<br/>")}</div>`,
    flags: { [MODULE_ID]: { itemId: item.id, actionId: item.actionId } }
  });
}

function escape(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
