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

export function suggestDefaultQueue(actor) {
  if (!actor?.items) return [];
  const suggestions = [];

  if (actor.type === "mech") {
    const mounts = actor.system?.loadout?.weapon_mounts ?? [];
    const loaded = [];
    for (let mi = 0; mi < mounts.length; mi++) {
      const weapons = getMountWeapons(actor, mi);
      if (weapons.length > 0) loaded.push({ index: mi, mount: mounts[mi], weapons });
    }
    if (loaded.length === 0) return suggestions;

    const superheavy = loaded.find(m => m.mount.type === "Superheavy");
    if (superheavy) {
      suggestions.push(createQueueItem(`mount:${superheavy.index}`, {
        payload: {
          mountIndex: superheavy.index,
          itemName: superheavy.weapons.map(w => w.name).join(" + "),
          cost: ACTION_COST.FULL, isAttack: true, icon: "fas fa-bullseye"
        }
      }));
    } else if (loaded.length === 1) {
      const m = loaded[0];
      for (let i = 0; i < 2; i++) {
        suggestions.push(createQueueItem(`mount:${m.index}`, {
          payload: {
            mountIndex: m.index,
            itemName: m.weapons.map(w => w.name).join(" + "),
            cost: ACTION_COST.QUICK, isAttack: true, icon: "fas fa-crosshairs"
          }
        }));
      }
    } else {
      const m1 = loaded[0], m2 = loaded[1];
      suggestions.push(createQueueItem("barrage", {
        payload: {
          mountIndices: [m1.index, m2.index],
          itemName: `${m1.weapons.map(w => w.name).join("+")} + ${m2.weapons.map(w => w.name).join("+")}`,
          cost: ACTION_COST.FULL, isAttack: true, icon: "fas fa-bullseye"
        }
      }));
    }
    return suggestions;
  }

  const weapons = [];
  for (const item of actor.items) {
    if (item.type === "pilot_weapon") weapons.push(item);
    else if (item.type === "npc_feature" && item.system?.type?.toLowerCase?.() === "weapon") weapons.push(item);
  }
  if (weapons.length === 0) return suggestions;

  if (weapons.length === 1) {
    const w = weapons[0];
    const cost = w.type === "npc_feature" ? resolveNpcFeatureCost(w) : ACTION_COST.QUICK;
    suggestions.push(createQueueItem(`weapon:${w.id}`, {
      payload: { itemId: w.id, itemName: w.name, cost, isAttack: true, icon: "fas fa-crosshairs" }
    }));
    suggestions.push(createQueueItem(`weapon:${w.id}`, {
      payload: { itemId: w.id, itemName: w.name, cost, isAttack: true, icon: "fas fa-crosshairs" }
    }));
  } else {
    const w1 = weapons[0], w2 = weapons[1];
    suggestions.push(createQueueItem("barrage", {
      payload: {
        weaponId: w1.id,
        itemName: `${w1.name} + ${w2.name}`,
        isAttack: true, icon: "fas fa-bullseye"
      }
    }));
  }

  if (actor.type === "deployable") {
    const sysActions = actor.system?.actions ?? [];
    for (let ai = 0; ai < sysActions.length; ai++) {
      const action = sysActions[ai];
      if (!action.name) continue;
      const activation = action.activation || "Quick";
      const cost = ACTIVATION_MAP[activation] || ACTION_COST.QUICK;
      if (cost === ACTION_COST.REACTION || cost === ACTION_COST.PROTOCOL) continue;
      const isAttack = (action.damage?.length > 0) || (action.range?.length > 0);
      suggestions.push(createQueueItem(`deployable:${ai}`, {
        payload: {
          actionIndex: ai,
          itemName: action.name,
          cost,
          isAttack,
          icon: isAttack ? "fas fa-crosshairs" : "fas fa-cog"
        }
      }));
    }
    return suggestions;
  }

  return suggestions;
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
      } else if (featureType === "system" || featureType === "trait") {
        const hasAction = item.system?.actions?.length > 0 ||
          (item.system?.tags ?? []).some(t => TAG_COST_MAP[t.id ?? t.tag?.id]);
        if (hasAction) {
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
        }
      }
    }

    if (item.type === "mech_system") {
      const hasAction = item.system?.actions?.length > 0;
      if (hasAction) {
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
      const hasAction = item.system?.actions?.length > 0;
      if (hasAction) {
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
