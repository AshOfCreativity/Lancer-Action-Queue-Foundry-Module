import { MODULE_ID, FLAGS, QUEUE_ITEM_STATUS, createQueueItem } from "./constants.mjs";

/**
 * Queue persistence.
 *
 * The queue lives on a Combatant flag during combat. If the caller passes an
 * Actor (no active combat), we fall back to the actor's flags so the queue
 * still persists across reload. Same shape either way: an array of queue items.
 */

function getDoc(holder) {
  // Allow callers to pass either a Combatant or an Actor.
  return holder ?? null;
}

export function getQueue(holder) {
  const doc = getDoc(holder);
  if (!doc) return [];
  const queue = doc.getFlag(MODULE_ID, FLAGS.queue);
  return Array.isArray(queue) ? queue : [];
}

export async function setQueue(holder, queue) {
  const doc = getDoc(holder);
  if (!doc) return [];
  const safe = Array.isArray(queue) ? queue : [];
  await doc.setFlag(MODULE_ID, FLAGS.queue, safe);
  return safe;
}

export async function addItem(holder, actionId, opts = {}) {
  const queue = getQueue(holder);
  const item = createQueueItem(actionId, opts);
  queue.push(item);
  await setQueue(holder, queue);
  return item;
}

export async function updateItem(holder, itemId, updates) {
  const queue = getQueue(holder);
  const idx = queue.findIndex(i => i.id === itemId);
  if (idx === -1) return null;
  queue[idx] = { ...queue[idx], ...updates };
  await setQueue(holder, queue);
  return queue[idx];
}

export async function removeItem(holder, itemId) {
  const queue = getQueue(holder).filter(i => i.id !== itemId);
  await setQueue(holder, queue);
  return queue;
}

export async function reorderQueue(holder, orderedIds) {
  const queue = getQueue(holder);
  const byId = new Map(queue.map(i => [i.id, i]));
  const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
  // Append any items that weren't in orderedIds (shouldn't happen, but defensive).
  for (const item of queue) {
    if (!orderedIds.includes(item.id)) reordered.push(item);
  }
  await setQueue(holder, reordered);
  return reordered;
}

export async function clearQueue(holder) {
  await setQueue(holder, []);
}

export async function setItemStatus(holder, itemId, status) {
  if (!Object.values(QUEUE_ITEM_STATUS).includes(status)) {
    throw new Error(`Invalid queue item status: ${status}`);
  }
  return updateItem(holder, itemId, { status });
}
