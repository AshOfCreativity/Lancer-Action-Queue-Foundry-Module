export const MODULE_ID = "lancer-action-queue";

export const FLAGS = {
  queue: "queue"
};

export const ACTION_CATEGORIES = {
  QUICK: "quick",
  FULL: "full",
  REACTION: "reaction",
  FREE: "free",
  PROTOCOL: "protocol",
  OTHER: "other"
};

export const ACTION_COST = {
  QUICK: "quick",
  FULL: "full",
  FREE: "free",
  REACTION: "reaction",
  PROTOCOL: "protocol",
  NONE: "none"
};

export const ACTION_CATALOG = [
  { id: "skirmish",   category: ACTION_CATEGORIES.QUICK,    isAttack: true,  icon: "fas fa-crosshairs",    cost: ACTION_COST.QUICK },
  { id: "barrage",    category: ACTION_CATEGORIES.FULL,     isAttack: true,  icon: "fas fa-bullseye",      cost: ACTION_COST.FULL },
  { id: "improvised", category: ACTION_CATEGORIES.QUICK,    isAttack: true,  icon: "fas fa-fist-raised",   cost: ACTION_COST.QUICK },
  { id: "ram",        category: ACTION_CATEGORIES.QUICK,    isAttack: true,  icon: "fas fa-truck-monster",  cost: ACTION_COST.QUICK },
  { id: "grapple",    category: ACTION_CATEGORIES.QUICK,    isAttack: true,  icon: "fas fa-hands",         cost: ACTION_COST.QUICK },

  { id: "quick-tech", category: ACTION_CATEGORIES.QUICK,    isAttack: false, icon: "fas fa-wrench",        cost: ACTION_COST.QUICK },
  { id: "full-tech",  category: ACTION_CATEGORIES.FULL,     isAttack: false, icon: "fas fa-cogs",          cost: ACTION_COST.FULL },
  { id: "boost",      category: ACTION_CATEGORIES.QUICK,    isAttack: false, icon: "fas fa-running",       cost: ACTION_COST.QUICK },
  { id: "hide",       category: ACTION_CATEGORIES.QUICK,    isAttack: false, icon: "fas fa-user-secret",   cost: ACTION_COST.QUICK },
  { id: "search",     category: ACTION_CATEGORIES.QUICK,    isAttack: false, icon: "fas fa-search",        cost: ACTION_COST.QUICK },

  { id: "overwatch",  category: ACTION_CATEGORIES.REACTION, isAttack: true,  icon: "fas fa-eye",           cost: ACTION_COST.REACTION },
  { id: "brace",      category: ACTION_CATEGORIES.REACTION, isAttack: false, icon: "fas fa-shield-alt",    cost: ACTION_COST.REACTION },

  { id: "stabilize",  category: ACTION_CATEGORIES.FREE,     isAttack: false, icon: "fas fa-heart",         cost: ACTION_COST.FREE },
  { id: "disengage",  category: ACTION_CATEGORIES.FREE,     isAttack: false, icon: "fas fa-shoe-prints",   cost: ACTION_COST.FREE },

  { id: "protocol",   category: ACTION_CATEGORIES.PROTOCOL, isAttack: false, icon: "fas fa-bolt",          cost: ACTION_COST.PROTOCOL },
  { id: "overcharge", category: ACTION_CATEGORIES.OTHER,    isAttack: false, icon: "fas fa-fire",          cost: ACTION_COST.NONE },
  { id: "custom",     category: ACTION_CATEGORIES.OTHER,    isAttack: false, icon: "fas fa-pencil-alt",    cost: ACTION_COST.NONE }
];

export function getActionDef(actionId) {
  return ACTION_CATALOG.find(a => a.id === actionId) || null;
}

export const QUEUE_ITEM_STATUS = {
  PENDING: "pending",
  FIRED: "fired",
  SKIPPED: "skipped"
};

export function newQueueItemId() {
  return `aq-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Construct a fresh queue item. `payload` carries action-specific config
 * (weaponId, targets, accuracy, difficulty, customName) and `notes` is freeform.
 */
export function createQueueItem(actionId, { payload = {}, notes = "" } = {}) {
  return {
    id: newQueueItemId(),
    actionId,
    status: QUEUE_ITEM_STATUS.PENDING,
    notes,
    payload,
    createdAt: Date.now()
  };
}

const ACTIVATION_MAP = {
  "Full": ACTION_COST.FULL,
  "Quick": ACTION_COST.QUICK,
  "Free": ACTION_COST.FREE,
  "Reaction": ACTION_COST.REACTION,
  "Protocol": ACTION_COST.PROTOCOL
};

const TAG_COST_MAP = {
  "tg_full_action": ACTION_COST.FULL,
  "tg_quick_action": ACTION_COST.QUICK,
  "tg_free_action": ACTION_COST.FREE,
  "tg_protocol": ACTION_COST.PROTOCOL,
  "tg_reaction": ACTION_COST.REACTION
};

function resolveNpcFeatureCost(item) {
  const tags = item.system?.tags ?? [];
  for (const tag of tags) {
    const mapped = TAG_COST_MAP[tag.id ?? tag.tag?.id];
    if (mapped) return mapped;
  }
  const featureType = item.system?.type?.toLowerCase?.();
  if (featureType === "reaction") return ACTION_COST.REACTION;
  if (featureType === "weapon" || featureType === "tech") return ACTION_COST.QUICK;
  return ACTION_COST.QUICK;
}

function resolveMechActionCost(item) {
  const actions = item.system?.actions;
  if (actions?.length > 0) {
    const mapped = ACTIVATION_MAP[actions[0].activation];
    if (mapped) return mapped;
  }
  return ACTION_COST.QUICK;
}

function costToCategory(cost) {
  if (cost === ACTION_COST.FULL) return ACTION_CATEGORIES.FULL;
  if (cost === ACTION_COST.FREE) return ACTION_CATEGORIES.FREE;
  if (cost === ACTION_COST.REACTION) return ACTION_CATEGORIES.REACTION;
  if (cost === ACTION_COST.PROTOCOL) return ACTION_CATEGORIES.PROTOCOL;
  return ACTION_CATEGORIES.QUICK;
}

/**
 * Get the action cost of a queue item — used for economy tracking.
 * Standard actions use their catalog entry's cost.
 * Actor actions read cost from payload (set by getActorActions at queue time).
 */
export function getItemCost(item) {
  const def = getActionDef(item.actionId);
  if (def) return def.cost;
  if (item.payload?.cost) return item.payload.cost;
  if (item.actionId.startsWith("reaction:")) return ACTION_COST.REACTION;
  if (item.actionId.startsWith("deployable:")) return item.payload?.cost || ACTION_COST.QUICK;
  return ACTION_COST.NONE;
}

/**
 * Compute action economy for a queue: how many quick/full actions used and budget.
 * NPCs get 2 activations (each = 1 quick or 1 full). PCs get 2 quick or 1 full + 1 quick.
 * Overcharge adds 1 quick action to the budget for the turn it's used.
 */
export function computeActionEconomy(queue, actor) {
  let quickUsed = 0;
  let fullUsed = 0;
  let overcharges = 0;
  let protocols = 0;
  let reactions = 0;

  for (const item of queue) {
    if (item.status !== QUEUE_ITEM_STATUS.PENDING) continue;
    const cost = getItemCost(item);
    if (cost === ACTION_COST.QUICK) quickUsed++;
    else if (cost === ACTION_COST.FULL) fullUsed++;
    else if (cost === ACTION_COST.REACTION) reactions++;
    else if (cost === ACTION_COST.PROTOCOL) protocols++;
    if (item.actionId === "overcharge") overcharges++;
  }

  const isNpc = actor?.type === "npc";
  const baseBudget = isNpc ? 2 : 2;
  const totalBudget = baseBudget + overcharges;
  const pointsUsed = quickUsed + (fullUsed * 2);

  return {
    quickUsed, fullUsed, overcharges, protocols, reactions,
    totalBudget, pointsUsed,
    overBudget: pointsUsed > totalBudget
  };
}

/**
 * Build a near-complete queue for an actor's upcoming turn.
 *
 * Options:
 *   autoTarget      - fill payload.targetIds with the nearest visible hostile
 *                     within weapon range. Default true.
 *   pickRecharges   - include charged NPC recharge features. Default true.
 *   includeProtocols- lead with a protocol feature if the actor has one. Default true.
 *   tierAccuracy    - pre-fill payload.accuracy from the NPC's tier
 *                     (max(0, tier - 1), capped at 2). Default true.
 *   sourceToken     - override the Token used for distance / LOS checks.
 *   maxItems        - hard cap on returned items. Default 8.
 *
 * Returns an array of queue items; the caller writes them to a holder.
 * All behaviour is deterministic given the same canvas state.
 */
export function suggestForActor(actor, options = {}) {
  const {
    autoTarget = true,
    pickRecharges = true,
    includeProtocols = true,
    tierAccuracy = true,
    sourceToken = null,
    maxItems = 8
  } = options;

  const items = [];
  if (!actor?.items) return items;

  const token = sourceToken ?? resolveActorToken(actor);
  const tier = getActorTier(actor);
  const accuracy = tierAccuracy ? Math.max(0, Math.min(2, (tier ?? 1) - 1)) : 0;
  const hostiles = token ? gatherHostileTokens(token) : [];

  const pushAttackItem = (actionId, payload, weapon) => {
    if (autoTarget && token && hostiles.length > 0 && weapon) {
      const range = computeWeaponRange(weapon);
      const target = pickNearestInRange(token, hostiles, range);
      if (target) {
        payload.targetIds = [target.id];
        payload.targetNames = [target.name];
      }
    }
    if (accuracy > 0 && payload.accuracy == null) payload.accuracy = accuracy;
    items.push(createQueueItem(actionId, { payload }));
  };

  // ---- Deployables ----
  if (actor.type === "deployable") {
    const sysActions = actor.system?.actions ?? [];
    for (let ai = 0; ai < sysActions.length; ai++) {
      const action = sysActions[ai];
      if (!action.name) continue;
      const activation = action.activation || "Quick";
      const cost = ACTIVATION_MAP[activation] || ACTION_COST.QUICK;
      if (cost === ACTION_COST.REACTION || cost === ACTION_COST.PROTOCOL) continue;
      const isAttack = (action.damage?.length > 0) || (action.range?.length > 0);
      const payload = {
        actionIndex: ai, itemName: action.name, cost, isAttack,
        icon: isAttack ? "fas fa-crosshairs" : "fas fa-cog"
      };
      const weaponShim = isAttack ? { system: { range: action.range ?? [] } } : null;
      if (isAttack) pushAttackItem(`deployable:${ai}`, payload, weaponShim);
      else items.push(createQueueItem(`deployable:${ai}`, { payload }));
    }
    return items.slice(0, maxItems);
  }

  // ---- Mechs ----
  if (actor.type === "mech") {
    const mounts = actor.system?.loadout?.weapon_mounts ?? [];
    const loaded = [];
    for (let mi = 0; mi < mounts.length; mi++) {
      const weapons = getMountWeapons(actor, mi);
      if (weapons.length > 0) loaded.push({ index: mi, mount: mounts[mi], weapons });
    }

    if (loaded.length > 0) {
      const superheavy = loaded.find(m => m.mount.type === "Superheavy");
      if (superheavy) {
        pushAttackItem(`mount:${superheavy.index}`, {
          mountIndex: superheavy.index,
          itemName: superheavy.weapons.map(w => w.name).join(" + "),
          cost: ACTION_COST.FULL, isAttack: true, icon: "fas fa-bullseye"
        }, superheavy.weapons[0]);
      } else if (loaded.length === 1) {
        const m = loaded[0];
        const name = m.weapons.map(w => w.name).join(" + ");
        for (let i = 0; i < 2; i++) {
          pushAttackItem(`mount:${m.index}`, {
            mountIndex: m.index, itemName: name,
            cost: ACTION_COST.QUICK, isAttack: true, icon: "fas fa-crosshairs"
          }, m.weapons[0]);
        }
      } else {
        const m1 = loaded[0], m2 = loaded[1];
        const payload = {
          mountIndices: [m1.index, m2.index],
          itemName: `${m1.weapons.map(w => w.name).join("+")} + ${m2.weapons.map(w => w.name).join("+")}`,
          cost: ACTION_COST.FULL, isAttack: true, icon: "fas fa-bullseye"
        };
        // Target the closer hostile that both mounts can reach (conservative).
        if (autoTarget && token && hostiles.length > 0) {
          const shortest = Math.min(
            computeWeaponRange(m1.weapons[0]),
            computeWeaponRange(m2.weapons[0])
          );
          const target = pickNearestInRange(token, hostiles, shortest);
          if (target) {
            payload.targetIds = [target.id];
            payload.targetNames = [target.name];
          }
        }
        if (accuracy > 0) payload.accuracy = accuracy;
        items.push(createQueueItem("barrage", { payload }));
      }
    }

    if (pickRecharges) appendChargedRecharges(actor, items, { token, hostiles, autoTarget, accuracy });
    if (includeProtocols) prependProtocol(actor, items);
    return items.slice(0, maxItems);
  }

  // ---- Non-mech (NPCs, pilots, vehicles) ----
  const weapons = collectActorWeapons(actor);

  if (weapons.length === 1) {
    const w = weapons[0];
    const cost = w.type === "npc_feature" ? resolveNpcFeatureCost(w) : ACTION_COST.QUICK;
    for (let i = 0; i < 2; i++) {
      pushAttackItem(`weapon:${w.id}`, {
        itemId: w.id, itemName: w.name, cost, isAttack: true, icon: "fas fa-crosshairs"
      }, w);
    }
  } else if (weapons.length >= 2) {
    // Fire each of the first two weapons as its own action. This is an
    // effective NPC "barrage" that routes through the weapon-id executor
    // branch, avoiding the standalone "barrage" payload that loses weapon 2.
    for (const w of weapons.slice(0, 2)) {
      const cost = w.type === "npc_feature" ? resolveNpcFeatureCost(w) : ACTION_COST.QUICK;
      pushAttackItem(`weapon:${w.id}`, {
        itemId: w.id, itemName: w.name, cost, isAttack: true, icon: "fas fa-crosshairs"
      }, w);
    }
  }

  if (pickRecharges) appendChargedRecharges(actor, items, { token, hostiles, autoTarget, accuracy });
  if (includeProtocols) prependProtocol(actor, items);

  return items.slice(0, maxItems);
}

/**
 * Backward-compatible entry point. Equivalent to suggestForActor(actor, {autoTarget: true}).
 */
export function suggestDefaultQueue(actor) {
  return suggestForActor(actor, { autoTarget: true });
}

function collectActorWeapons(actor) {
  const weapons = [];
  for (const item of actor.items ?? []) {
    if (item.system?.destroyed) continue;
    if (item.type === "pilot_weapon") weapons.push(item);
    else if (item.type === "npc_feature" && item.system?.type?.toLowerCase?.() === "weapon") weapons.push(item);
  }
  return weapons;
}

function hasRechargeTag(item) {
  const tags = item.system?.tags ?? [];
  return tags.some(t => (t.lid ?? t.id ?? t.tag?.id ?? t.tag?.lid) === "tg_recharge");
}

function appendChargedRecharges(actor, items, ctx) {
  for (const item of actor.items ?? []) {
    if (item.type !== "npc_feature") continue;
    if (item.system?.destroyed) continue;
    if (!hasRechargeTag(item)) continue;
    // Not yet recharged this turn — skip.
    if (item.system?.charged === false) continue;
    const featureType = item.system?.type?.toLowerCase?.();
    if (featureType === "reaction") continue;
    const cost = resolveNpcFeatureCost(item);
    if (cost === ACTION_COST.PROTOCOL) continue;
    // Skip if the item is already in the queue (avoids double-queueing a weapon suggestion).
    if (items.some(it => it.payload?.itemId === item.id)) continue;

    const isAttack = (featureType === "weapon" || featureType === "tech");
    const actionId = featureType === "weapon"
      ? `weapon:${item.id}`
      : featureType === "tech"
        ? `tech:${item.id}`
        : `system:${item.id}`;
    const payload = {
      itemId: item.id, itemName: item.name, cost, isAttack,
      icon: isAttack ? (featureType === "tech" ? "fas fa-wrench" : "fas fa-crosshairs") : "fas fa-bolt"
    };
    if (isAttack && ctx.autoTarget && ctx.token && ctx.hostiles.length > 0) {
      const range = computeWeaponRange(item);
      const target = pickNearestInRange(ctx.token, ctx.hostiles, range);
      if (target) {
        payload.targetIds = [target.id];
        payload.targetNames = [target.name];
      }
    }
    if (isAttack && ctx.accuracy > 0) payload.accuracy = ctx.accuracy;
    items.push(createQueueItem(actionId, { payload }));
  }
}

function prependProtocol(actor, items) {
  if (items.some(it => getItemCost(it) === ACTION_COST.PROTOCOL)) return;
  for (const item of actor.items ?? []) {
    if (item.system?.destroyed) continue;
    let cost = null;
    if (item.type === "npc_feature") cost = resolveNpcFeatureCost(item);
    else if (item.type === "mech_system" || item.type === "pilot_gear") cost = resolveMechActionCost(item);
    if (cost !== ACTION_COST.PROTOCOL) continue;
    if (hasRechargeTag(item) && item.system?.charged === false) continue;

    items.unshift(createQueueItem(`system:${item.id}`, {
      payload: {
        itemId: item.id, itemName: item.name, cost: ACTION_COST.PROTOCOL,
        isAttack: false, icon: "fas fa-bolt"
      }
    }));
    return; // one protocol per turn
  }
}

function getActorTier(actor) {
  const raw = actor?.system?.tier;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.min(3, Math.max(1, Math.floor(raw)));
  }
  return null;
}

/**
 * Resolve a Token placeable for an actor. Only returns a token on the active scene;
 * if none is placed, targeting is simply disabled (the GM can still accept the queue).
 */
function resolveActorToken(actor) {
  if (!actor) return null;
  const placeables = globalThis.canvas?.tokens?.placeables ?? [];
  const match = placeables.find(t => t.actor?.id === actor.id);
  if (match) return match;
  const linked = actor.getActiveTokens?.(true, false) ?? [];
  if (linked[0]) return linked[0];
  return null;
}

/**
 * Gather currently-visible hostile Tokens relative to a source Token.
 *
 * Hostile = opposite disposition sign. Neutral / Secret dispositions are skipped
 * so we never auto-target a token that could be either side. Honours visibility
 * (so the GM's auto-pick never touches tokens hidden on the current layer) and
 * drops combatants already flagged as defeated.
 */
function gatherHostileTokens(sourceToken) {
  if (!sourceToken) return [];
  const placeables = globalThis.canvas?.tokens?.placeables ?? [];
  const srcDisp = sourceToken.document?.disposition ?? sourceToken.disposition ?? -1;
  const srcSign = Math.sign(srcDisp);
  if (srcSign === 0) return [];

  const combatants = globalThis.game?.combat?.combatants?.contents ?? [];
  const out = [];
  for (const t of placeables) {
    if (t.id === sourceToken.id) continue;
    if (!t.actor) continue;
    if (t.visible === false) continue;
    const d = t.document?.disposition ?? t.disposition ?? 0;
    const tgtSign = Math.sign(d);
    if (tgtSign === 0) continue;
    if (tgtSign === srcSign) continue;
    const combatant = combatants.find(c => c.tokenId === t.id);
    if (combatant?.isDefeated) continue;
    out.push(t);
  }
  return out;
}

/**
 * Longest usable range for a weapon-like item, in grid spaces. Prefers Range /
 * Thrown types; falls back to Threat for melee. Infinity means "no range data —
 * don't filter targets".
 */
function computeWeaponRange(weapon) {
  if (!weapon) return Infinity;
  const ranges = readWeaponRanges(weapon);
  if (ranges.length === 0) return Infinity;
  let best = 0;
  for (const r of ranges) {
    const type = r?.type ?? "";
    if (type === "Range" || type === "Thrown") best = Math.max(best, Number(r?.val) || 0);
  }
  if (best > 0) return best;
  for (const r of ranges) {
    const type = r?.type ?? "";
    if (type === "Threat") best = Math.max(best, Number(r?.val) || 1);
  }
  return best > 0 ? best : Infinity;
}

function readWeaponRanges(weapon) {
  const sys = weapon?.system;
  if (!sys) return [];
  if (sys.active_profile?.range) return sys.active_profile.range;
  if (Array.isArray(sys.range)) return sys.range;
  if (Array.isArray(sys.profiles) && sys.profiles[0]?.range) return sys.profiles[0].range;
  return [];
}

/**
 * Pick the nearest hostile within maxRangeSpaces of sourceToken. Uses
 * canvas.grid.measurePath (v12), falling back to pixel euclidean. Deterministic:
 * ties resolve to the first in the hostiles array.
 */
function pickNearestInRange(sourceToken, hostiles, maxRangeSpaces) {
  if (!hostiles?.length) return null;
  const grid = globalThis.canvas?.grid;
  const gridDist = grid?.distance ?? 1;
  const maxDist = maxRangeSpaces === Infinity ? Infinity : maxRangeSpaces * gridDist;

  const srcCenter = sourceToken.center ?? { x: sourceToken.x, y: sourceToken.y };
  let best = null;
  let bestDist = Infinity;
  for (const t of hostiles) {
    const tgtCenter = t.center ?? { x: t.x, y: t.y };
    let dist;
    try {
      const measured = grid?.measurePath?.([srcCenter, tgtCenter]);
      dist = measured?.distance ?? null;
      if (dist == null && typeof grid?.measureDistance === "function") {
        dist = grid.measureDistance(srcCenter, tgtCenter);
      }
    } catch {
      dist = null;
    }
    if (dist == null) {
      const dx = tgtCenter.x - srcCenter.x;
      const dy = tgtCenter.y - srcCenter.y;
      const pixels = Math.hypot(dx, dy);
      const size = grid?.size ?? 100;
      dist = (pixels / size) * gridDist;
    }
    if (dist > maxDist) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

export function getMountWeapons(actor, mountIndex) {
  const mounts = actor?.system?.loadout?.weapon_mounts;
  if (!mounts || mountIndex >= mounts.length) return [];
  const mount = mounts[mountIndex];
  const weapons = [];
  for (const slot of (mount.slots ?? [])) {
    const ref = slot.weapon;
    if (!ref) continue;
    let w = ref.value;
    if (typeof w === "string") w = actor.items.get(w);
    if (w) weapons.push(w);
  }
  return weapons;
}

export function getActorActions(actor) {
  if (!actor?.items) return [];

  const actions = [];
  const isMech = actor.type === "mech";

  if (isMech) {
    const mounts = actor.system?.loadout?.weapon_mounts ?? [];
    for (let mi = 0; mi < mounts.length; mi++) {
      const mount = mounts[mi];
      const weapons = getMountWeapons(actor, mi);
      if (weapons.length === 0) continue;
      const isSuperheavy = mount.type === "Superheavy";
      const cost = isSuperheavy ? ACTION_COST.FULL : ACTION_COST.QUICK;
      const weaponNames = weapons.map(w => w.name);
      actions.push({
        id: `mount:${mi}`,
        name: `${mount.type ?? "Mount"}: ${weaponNames.join(" + ")}`,
        category: isSuperheavy ? ACTION_CATEGORIES.FULL : ACTION_CATEGORIES.QUICK,
        cost,
        isAttack: true,
        isWeapon: true,
        isMount: true,
        icon: isSuperheavy ? "fas fa-bullseye" : "fas fa-crosshairs",
        mountIndex: mi,
        mountType: mount.type,
        weaponIds: weapons.map(w => w.id),
        weaponNames
      });
    }
  }

  for (const item of actor.items) {
    if (isMech && item.type === "mech_weapon") continue;

    if (item.type === "pilot_weapon") {
      actions.push({
        id: `weapon:${item.id}`,
        name: item.name,
        category: ACTION_CATEGORIES.QUICK,
        cost: ACTION_COST.QUICK,
        isAttack: true,
        isWeapon: true,
        icon: "fas fa-crosshairs",
        itemId: item.id,
        itemType: item.type
      });
    }

    if (item.type === "npc_feature") {
      const featureType = item.system?.type?.toLowerCase?.();
      const cost = resolveNpcFeatureCost(item);
      const category = featureType === "reaction" ? ACTION_CATEGORIES.REACTION : costToCategory(cost);

      if (featureType === "weapon") {
        actions.push({
          id: `weapon:${item.id}`,
          name: item.name,
          category,
          cost,
          isAttack: true,
          isWeapon: true,
          icon: "fas fa-crosshairs",
          itemId: item.id,
          itemType: "npc_feature"
        });
      } else if (featureType === "tech") {
        actions.push({
          id: `tech:${item.id}`,
          name: item.name,
          category,
          cost,
          isAttack: true,
          isWeapon: false,
          isTech: true,
          icon: "fas fa-wrench",
          itemId: item.id,
          itemType: "npc_feature"
        });
      } else if (featureType === "reaction") {
        actions.push({
          id: `reaction:${item.id}`,
          name: item.name,
          category: ACTION_CATEGORIES.REACTION,
          cost: ACTION_COST.REACTION,
          isAttack: false,
          isWeapon: false,
          icon: "fas fa-bolt",
          itemId: item.id,
          itemType: "npc_feature"
        });
      } else if (featureType === "system") {
        actions.push({
          id: `system:${item.id}`,
          name: item.name,
          category,
          cost,
          isAttack: false,
          isWeapon: false,
          icon: "fas fa-cog",
          itemId: item.id,
          itemType: "npc_feature"
        });
      } else if (featureType === "trait") {
        actions.push({
          id: `system:${item.id}`,
          name: item.name,
          category: ACTION_CATEGORIES.FREE,
          cost: ACTION_COST.FREE,
          isAttack: false,
          isWeapon: false,
          icon: "fas fa-book-open",
          itemId: item.id,
          itemType: "npc_feature"
        });
      }
    }

    if (item.type === "mech_system") {
      const hasActivation = item.system?.actions?.length > 0 ||
        (item.system?.deployables?.length > 0) ||
        (item.system?.tags ?? []).some(t => TAG_COST_MAP[t.id ?? t.tag?.id]);
      if (hasActivation) {
        const cost = resolveMechActionCost(item);
        actions.push({
          id: `system:${item.id}`,
          name: item.name,
          category: costToCategory(cost),
          cost,
          isAttack: false,
          isWeapon: false,
          icon: "fas fa-cog",
          itemId: item.id,
          itemType: "mech_system"
        });
      }
    }

    if (item.type === "pilot_gear") {
      const hasActivation = item.system?.actions?.length > 0 ||
        (item.system?.tags ?? []).some(t => TAG_COST_MAP[t.id ?? t.tag?.id]);
      if (hasActivation) {
        const cost = resolveMechActionCost(item);
        actions.push({
          id: `system:${item.id}`,
          name: item.name,
          category: costToCategory(cost),
          cost,
          isAttack: false,
          isWeapon: false,
          icon: "fas fa-toolbox",
          itemId: item.id,
          itemType: "pilot_gear"
        });
      }
    }
  }

  // Deployable actor actions from system.actions
  if (actor.type === "deployable") {
    const sysActions = actor.system?.actions ?? [];
    for (let ai = 0; ai < sysActions.length; ai++) {
      const action = sysActions[ai];
      if (!action.name) continue;
      const activation = action.activation || "Quick";
      const cost = ACTIVATION_MAP[activation] || ACTION_COST.QUICK;
      const isAttack = (action.damage?.length > 0) || (action.range?.length > 0);
      const isTech = !!action.tech_attack;

      actions.push({
        id: `deployable:${ai}`,
        name: action.name,
        category: costToCategory(cost),
        cost,
        isAttack,
        isWeapon: false,
        isTech,
        icon: isTech ? "fas fa-wrench" : isAttack ? "fas fa-crosshairs" : "fas fa-cog",
        actionIndex: ai,
        itemType: "deployable_action"
      });
    }
  }

  return actions;
}
