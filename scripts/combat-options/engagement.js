import {
  ENGAGED_CONDITION_CONFIG,
  ENGAGED_CONDITION_FLAG_SOURCE,
  ENGAGED_CONDITION_ID,
  MODULE_ID
} from "./constants.js";
import { log, logError } from "./logging.js";
import {
  collectEngagedTokenIds,
  getCanvasMeasurementContext,
  getTokenDisposition,
  tokenIsDefeated
} from "./measurement.js";
import { isActivePrimaryGM } from "./permissions.js";

function getActorIdentifier(actor, token = null) {
  if (actor?.id) return actor.id;
  if (actor?.uuid) return actor.uuid;
  if (token?.id) return token.id;
  return null;
}

export function getEngagedEffect(actor) {
  if (!actor) return null;

  if (typeof actor.hasCondition === "function") {
    const effect = actor.hasCondition(ENGAGED_CONDITION_ID);
    if (effect) return effect;
  }

  const effects = actor.effects;
  if (Array.isArray(effects)) {
    return effects.find((effect) => effect?.statuses?.has?.(ENGAGED_CONDITION_ID)) ?? null;
  }

  return null;
}

async function syncEngagedCondition(actor, engaged) {
  if (!actor || typeof actor !== "object") return;

  const existingEffect = getEngagedEffect(actor);
  const hasEffect = Boolean(existingEffect);

  if (engaged) {
    if (hasEffect) return;
    if (typeof actor.addCondition !== "function") return;
    try {
      await actor.addCondition(ENGAGED_CONDITION_ID, { [MODULE_ID]: { source: ENGAGED_CONDITION_FLAG_SOURCE } });
    } catch (err) {
      logError("Failed to add Engaged condition", err);
    }
    return;
  }

  if (!hasEffect) return;

  const flagSource = existingEffect?.getFlag?.(MODULE_ID, "source")
    ?? existingEffect?.flags?.[MODULE_ID]?.source;

  if (flagSource && flagSource !== ENGAGED_CONDITION_FLAG_SOURCE) {
    return;
  }

  if (typeof existingEffect?.delete === "function") {
    try {
      await existingEffect.delete();
    } catch (err) {
      logError("Failed to remove Engaged condition", err);
    }
    return;
  }

  if (typeof actor.removeCondition === "function") {
    try {
      await actor.removeCondition(ENGAGED_CONDITION_ID);
    } catch (err) {
      logError("Failed to remove Engaged condition", err);
    }
  }
}

let reportedMissingAuraSupport = false;

function canUseNativeAuraAutomation() {
  const auraTransferType = game?.wng?.config?.transferTypes?.aura;
  if (!auraTransferType) return false;

  const warhammerRoot = game?.warhammer;
  if (!warhammerRoot || typeof warhammerRoot !== "object") return false;

  const auraManagers = [
    warhammerRoot.effectManager,
    warhammerRoot.effectScripts,
    warhammerRoot.utility?.templates,
    warhammerRoot.templates
  ];

  return auraManagers.some((entry) => entry && typeof entry === "object");
}

function reportMissingAuraAutomation() {
  if (reportedMissingAuraSupport) return;
  reportedMissingAuraSupport = true;
  log("debug", "Falling back to manual Engaged automation because the Wrath & Glory aura pipeline is not exposed to modules.");
}

function shouldAutoApplyEngaged() {
  const compatibleSystem = game.system?.id === "wrath-and-glory";
  const hasPrimaryGMPermissions = isActivePrimaryGM();
  if (!(compatibleSystem && hasPrimaryGMPermissions)) return false;

  if (!canUseNativeAuraAutomation()) {
    reportMissingAuraAutomation();
  }

  return true;
}

async function evaluateEngagedConditions() {
  if (!shouldAutoApplyEngaged()) return;
  const tokensLayer = canvas?.tokens;
  if (!tokensLayer) return;

  const placeables = Array.isArray(tokensLayer.placeables) ? tokensLayer.placeables : [];
  if (!placeables.length) return;

  const tokensWithActors = placeables.filter((token) => token?.actor);
  if (!tokensWithActors.length) return;

  const actorMap = new Map();
  for (const token of tokensWithActors) {
    const actor = token.actor;
    const actorId = getActorIdentifier(actor, token);
    if (!actor || !actorId) continue;
    if (!actorMap.has(actorId)) {
      actorMap.set(actorId, actor);
    }
  }

  if (!actorMap.size) return;

  const visibleTokens = tokensWithActors.filter((token) => !(token.document?.hidden ?? token.hidden));
  const eligibleTokens = visibleTokens.filter((token) => !tokenIsDefeated(token));
  const friendlyTokens = [];
  const hostileTokens = [];

  for (const token of eligibleTokens) {
    const disposition = getTokenDisposition(token);
    if (disposition > 0) {
      friendlyTokens.push(token);
    } else if (disposition < 0) {
      hostileTokens.push(token);
    }
  }

  const measurementContext = getCanvasMeasurementContext();
  const engagedTokenIds = collectEngagedTokenIds(friendlyTokens, hostileTokens, measurementContext);

  const engagedActorIds = new Set();
  if (engagedTokenIds.size) {
    for (const token of tokensWithActors) {
      if (!token?.id) continue;
      if (!engagedTokenIds.has(token.id)) continue;
      const actorId = getActorIdentifier(token.actor, token);
      if (actorId) {
        engagedActorIds.add(actorId);
      }
    }
  }

  const operations = [];
  for (const [actorId, actor] of actorMap.entries()) {
    const shouldBeEngaged = engagedActorIds.has(actorId);
    operations.push(syncEngagedCondition(actor, shouldBeEngaged));
  }

  if (operations.length) {
    await Promise.allSettled(operations);
  }
}

const requestEngagedEvaluation = (() => {
  const debounced = foundry.utils.debounce(() => {
    if (!canvas?.ready) return;
    const maybePromise = evaluateEngagedConditions();
    if (maybePromise?.catch) {
      maybePromise.catch((err) => logError("Failed to evaluate Engaged conditions", err));
    }
  }, 100);

  return () => debounced();
})();

function resolveSceneId(sceneLike) {
  if (!sceneLike) return null;
  if (typeof sceneLike.id === "string") return sceneLike.id;
  if (sceneLike.scene) return resolveSceneId(sceneLike.scene);
  if (sceneLike.parent) return resolveSceneId(sceneLike.parent);
  if (sceneLike.document) return resolveSceneId(sceneLike.document);
  return null;
}

function isActiveScene(sceneLike) {
  const currentSceneId = canvas?.scene?.id;
  if (!currentSceneId) return false;
  const targetSceneId = resolveSceneId(sceneLike);
  return targetSceneId === currentSceneId;
}

function handleTokenChange(scene) {
  if (game.system?.id !== "wrath-and-glory") return;
  if (scene && !isActiveScene(scene)) return;
  requestEngagedEvaluation();
}

function handleTokenDeletion(scene, tokenDocument) {
  if (game.system?.id !== "wrath-and-glory") return;
  if (scene && !isActiveScene(scene)) return;

  const actor = tokenDocument?.actor ?? null;
  if (!actor) return;

  const activeTokens = typeof actor.getActiveTokens === "function"
    ? actor.getActiveTokens(true)
    : [];

  const stillOnScene = activeTokens.some((token) => {
    const sceneRef = token?.scene ?? token?.document?.parent ?? token?.parent;
    return isActiveScene(sceneRef);
  });

  if (stillOnScene) return;

  const maybePromise = syncEngagedCondition(actor, false);
  if (maybePromise?.catch) {
    maybePromise.catch((err) => logError("Failed to remove Engaged condition after token deletion", err));
  }
}

function handleActorUpdate(actor, changed) {
  if (game.system?.id !== "wrath-and-glory") return;
  if (!changed) return;

  const hasSizeChange = foundry.utils.hasProperty?.(changed, "system.combat.size")
    || foundry.utils.hasProperty?.(changed, "system.size")
    || Object.prototype.hasOwnProperty.call(changed, "size");

  if (!hasSizeChange) return;

  const activeTokens = typeof actor?.getActiveTokens === "function"
    ? actor.getActiveTokens(true)
    : [];

  if (!activeTokens.some((token) => {
    const sceneRef = token?.scene ?? token?.document?.parent ?? token?.parent;
    return isActiveScene(sceneRef);
  })) return;

  requestEngagedEvaluation();
}

function handleTokenRefresh(token) {
  if (game.system?.id !== "wrath-and-glory") return;
  if (!token) return;

  const sceneRef = token.scene ?? token.document?.parent ?? token.parent;
  if (sceneRef && !isActiveScene(sceneRef)) return;

  requestEngagedEvaluation();
}

function registerEngagedStatusEffect() {
  if (game.system?.id !== "wrath-and-glory") return;
  if (!Array.isArray(CONFIG.statusEffects)) return;
  const existing = CONFIG.statusEffects.some((effect) => effect?.id === ENGAGED_CONDITION_ID);
  if (existing) return;
  CONFIG.statusEffects.push(foundry.utils.deepClone(ENGAGED_CONDITION_CONFIG));
}

export function registerEngagementAutomation() {
  Hooks.once("init", () => {
    registerEngagedStatusEffect();
  });

  Hooks.on("setup", () => {
    registerEngagedStatusEffect();
  });

  Hooks.once("ready", () => {
    if (game.system?.id !== "wrath-and-glory") return;

    registerEngagedStatusEffect();

    const systemEffects = game.wng?.config?.systemEffects;
    if (systemEffects && !systemEffects[ENGAGED_CONDITION_ID]) {
      systemEffects[ENGAGED_CONDITION_ID] = foundry.utils.deepClone(ENGAGED_CONDITION_CONFIG);
    }

    requestEngagedEvaluation();
  });

  Hooks.on("canvasReady", () => {
    if (game.system?.id !== "wrath-and-glory") return;
    requestEngagedEvaluation();
  });

  Hooks.on("updateUser", () => {
    if (game.system?.id !== "wrath-and-glory") return;
    requestEngagedEvaluation();
  });

  Hooks.on("createToken", (scene) => handleTokenChange(scene));
  Hooks.on("updateToken", (scene) => handleTokenChange(scene));
  Hooks.on("deleteToken", (scene, tokenDocument) => {
    handleTokenChange(scene);
    handleTokenDeletion(scene, tokenDocument);
  });
  Hooks.on("refreshToken", (token) => handleTokenRefresh(token));

  Hooks.on("updateActor", (actor, changed) => handleActorUpdate(actor, changed));
}

export { isActiveScene };
