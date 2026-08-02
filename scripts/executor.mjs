import { MODULE_ID, QUEUE_ITEM_STATUS, getActionDef } from "./constants.mjs";
import { getQueue, setItemStatus } from "./queue-store.mjs";

/**
 * Fire every PENDING item in the holder's queue, in order.
 *
 * V1 stub: posts a placeholder chat card per item and marks it FIRED. The real
 * LANCER integration plugs in here — replace the inner loop body with the
 * actual hand-off (pre-fill AccDiffHUD, or skip it and call LANCER's roll
 * system directly, or whatever shape we land on). Items already marked FIRED
 * are skipped so a partial fire-then-edit-then-fire-again flow works.
 *
 * Returns the number of items actually fired this call.
 */
export async function fireQueue(holder) {
  if (!holder) return 0;
  const queue = getQueue(holder);
  let fired = 0;
  for (const item of queue) {
    if (item.status !== QUEUE_ITEM_STATUS.PENDING) continue;
    await executeItem(holder, item);
    await setItemStatus(holder, item.id, QUEUE_ITEM_STATUS.FIRED);
    fired += 1;
  }
  return fired;
}

/**
 * Execute a single queue item. Currently posts a chat card; this is the seam
 * where AccDiffHUD pre-fill (or its replacement) will hook in.
 */
async function executeItem(holder, item) {
  const def = getActionDef(item.actionId);
  const actionName = item.payload?.customName?.trim()
    || (def ? game.i18n.localize(`ACTIONQUEUE.Actions.${item.actionId}`) : item.actionId);

  const lines = [`<strong>${escape(actionName)}</strong>`];
  const payload = item.payload ?? {};
  if (payload.weaponId && holder.actor) {
    const weapon = holder.actor.items?.get(payload.weaponId);
    if (weapon) lines.push(`Weapon: ${escape(weapon.name)}`);
  }
  if (Array.isArray(payload.targetNames) && payload.targetNames.length) {
    lines.push(`Targets: ${escape(payload.targetNames.join(", "))}`);
  }
  if (Number(payload.accuracy) > 0) lines.push(`Accuracy: +${Number(payload.accuracy)}`);
  if (Number(payload.difficulty) > 0) lines.push(`Difficulty: +${Number(payload.difficulty)}`);
  if (item.notes) lines.push(`<em>${escape(item.notes)}</em>`);

  const speaker = holder.actor
    ? ChatMessage.getSpeaker({ actor: holder.actor })
    : ChatMessage.getSpeaker();

  await ChatMessage.create({
    speaker,
    content: `<div class="lancer-action-queue-card"><div class="aq-card-tag">[Queued]</div>${lines.join("<br/>")}</div>`,
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
