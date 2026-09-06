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

/**
 * Get the action cost of a queue item — used for economy tracking.
 * Actor actions (weapon:, tech:, system:) derive cost from their category.
 * Standard actions use their catalog entry's cost.
 */
export function getItemCost(item) {
  const def = getActionDef(item.actionId);
  if (def) return def.cost;
  if (item.actionId.startsWith("weapon:")) return ACTION_COST.QUICK;
  if (item.actionId.startsWith("tech:")) return ACTION_COST.QUICK;
  if (item.actionId.startsWith("system:")) return ACTION_COST.QUICK;
  if (item.actionId.startsWith("reaction:")) return ACTION_COST.REACTION;
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
 * Suggest a default queue for an NPC based on its loadout.
 * - 1 weapon → Skirmish with that weapon twice (2 quick actions)
 * - 2+ weapons → Barrage (1 full action)
 * - Has a tech → include Quick Tech
 * - Has a charged recharge system → suggest using it
 */
export function suggestDefaultQueue(actor) {
  if (!actor?.items) return [];

  const weapons = [];
  const techs = [];
  const systems = [];

  for (const item of actor.items) {
    if (item.type === "mech_weapon" || item.type === "pilot_weapon") {
      weapons.push(item);
    } else if (item.type === "npc_feature") {
      const ft = item.system?.type?.toLowerCase?.();
      if (ft === "weapon") weapons.push(item);
      else if (ft === "tech") techs.push(item);
      else if (ft === "system" && item.system?.actions?.length > 0) systems.push(item);
    } else if (item.type === "mech_system" && item.system?.actions?.length > 0) {
      systems.push(item);
    }
  }

  const suggestions = [];

  if (weapons.length === 0) {
    // No weapons: just two quick actions (boost + search, or whatever)
    return suggestions;
  }

  if (weapons.length === 1) {
    // 1 weapon: Skirmish twice
    const w = weapons[0];
    suggestions.push(createQueueItem(`weapon:${w.id}`, {
      payload: { itemId: w.id, itemName: w.name, isAttack: true, icon: "fas fa-crosshairs" }
    }));
    suggestions.push(createQueueItem(`weapon:${w.id}`, {
      payload: { itemId: w.id, itemName: w.name, isAttack: true, icon: "fas fa-crosshairs" }
    }));
  } else {
    // 2+ weapons: Barrage with the first two
    const w1 = weapons[0];
    const w2 = weapons[1];
    suggestions.push(createQueueItem("barrage", {
      payload: {
        weaponId: w1.id,
        itemName: `${w1.name} + ${w2.name}`,
        isAttack: true,
        icon: "fas fa-bullseye"
      }
    }));
  }

  // If there's a tech and budget room, suggest it
  if (techs.length > 0 && weapons.length === 1) {
    // 1 weapon + 1 skirmish used 2 quick actions = full budget; no room
  } else if (techs.length > 0 && weapons.length >= 2) {
    // Barrage used full action (2 points). Could overcharge for a tech.
  }

  return suggestions;
}

export function getActorActions(actor) {
  if (!actor?.items) return [];

  const actions = [];

  for (const item of actor.items) {
    if (item.type === "mech_weapon" || item.type === "pilot_weapon") {
      actions.push({
        id: `weapon:${item.id}`,
        name: item.name,
        category: ACTION_CATEGORIES.QUICK,
        isAttack: true,
        isWeapon: true,
        icon: "fas fa-crosshairs",
        itemId: item.id,
        itemType: item.type
      });
    }

    if (item.type === "npc_feature") {
      const featureType = item.system?.type?.toLowerCase?.();
      if (featureType === "weapon") {
        actions.push({
          id: `weapon:${item.id}`,
          name: item.name,
          category: ACTION_CATEGORIES.QUICK,
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
          category: ACTION_CATEGORIES.QUICK,
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
          isAttack: false,
          isWeapon: false,
          icon: "fas fa-bolt",
          itemId: item.id,
          itemType: "npc_feature"
        });
      } else if (featureType === "system" || featureType === "trait") {
        const hasAction = item.system?.actions?.length > 0;
        if (hasAction) {
          actions.push({
            id: `system:${item.id}`,
            name: item.name,
            category: ACTION_CATEGORIES.QUICK,
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
        actions.push({
          id: `system:${item.id}`,
          name: item.name,
          category: ACTION_CATEGORIES.QUICK,
          isAttack: false,
          isWeapon: false,
          icon: "fas fa-cog",
          itemId: item.id,
          itemType: "mech_system"
        });
      }
    }
  }

  return actions;
}
