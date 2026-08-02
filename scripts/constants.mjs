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

/**
 * Standard LANCER actions available in the palette.
 * These are always shown regardless of actor type.
 */
export const ACTION_CATALOG = [
  { id: "skirmish",   category: ACTION_CATEGORIES.QUICK,    isAttack: true,  icon: "fas fa-crosshairs" },
  { id: "barrage",    category: ACTION_CATEGORIES.FULL,     isAttack: true,  icon: "fas fa-bullseye" },
  { id: "improvised", category: ACTION_CATEGORIES.QUICK,    isAttack: true,  icon: "fas fa-fist-raised" },
  { id: "ram",        category: ACTION_CATEGORIES.QUICK,    isAttack: true,  icon: "fas fa-truck-monster" },
  { id: "grapple",    category: ACTION_CATEGORIES.QUICK,    isAttack: true,  icon: "fas fa-hands" },

  { id: "quick-tech", category: ACTION_CATEGORIES.QUICK,    isAttack: false, icon: "fas fa-wrench" },
  { id: "full-tech",  category: ACTION_CATEGORIES.FULL,     isAttack: false, icon: "fas fa-cogs" },
  { id: "boost",      category: ACTION_CATEGORIES.QUICK,    isAttack: false, icon: "fas fa-running" },
  { id: "hide",       category: ACTION_CATEGORIES.QUICK,    isAttack: false, icon: "fas fa-user-secret" },
  { id: "search",     category: ACTION_CATEGORIES.QUICK,    isAttack: false, icon: "fas fa-search" },

  { id: "overwatch",  category: ACTION_CATEGORIES.REACTION, isAttack: true,  icon: "fas fa-eye" },
  { id: "brace",      category: ACTION_CATEGORIES.REACTION, isAttack: false, icon: "fas fa-shield-alt" },

  { id: "stabilize",  category: ACTION_CATEGORIES.FREE,     isAttack: false, icon: "fas fa-heart" },
  { id: "disengage",  category: ACTION_CATEGORIES.FREE,     isAttack: false, icon: "fas fa-shoe-prints" },

  { id: "protocol",   category: ACTION_CATEGORIES.PROTOCOL, isAttack: false, icon: "fas fa-bolt" },
  { id: "overcharge", category: ACTION_CATEGORIES.OTHER,    isAttack: false, icon: "fas fa-fire" },
  { id: "custom",     category: ACTION_CATEGORIES.OTHER,    isAttack: false, icon: "fas fa-pencil-alt" }
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
 * Collect weapons and actionable features from an actor for the palette.
 * Returns an array of palette entries representing the actor's own capabilities.
 */
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
