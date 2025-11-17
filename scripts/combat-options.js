// modules/wng-CombatExtender/scripts/combat-options.js
//
// This script enhances the Wrath & Glory weapon attack dialog with additional combat
// options. These options mirror the situational modifiers described in the core rules
// (e.g. aiming, charging, or fighting in poor visibility) and allow players to toggle
// them directly from the dialog. Most of the logic below focuses on three concerns:
//
//   1.  Preparing the Handlebars context used to render the custom UI section.
//   2.  Extending the dialog prototype so that selecting options recalculates the attack.
//   3.  Synchronising the dialog inputs after recalculations to keep the UI consistent.
//
// The result is a lightweight quality-of-life feature that avoids manual arithmetic at
// the table and keeps the core system untouched by applying changes at runtime.

const MODULE_ID = "wng-CombatExtender";
const MODULE_BASE_PATH = `modules/${MODULE_ID}`;
const TEMPLATE_BASE_PATH = `${MODULE_BASE_PATH}/templates`;
const MODULE_LABEL = "WNG Combat Extender";

// Lightweight wrapper around the console that prefixes every log line with the module
// label. This keeps the browser console readable when several modules are active.
const log = (level, message, ...data) => {
  const logger = console[level] ?? console.log;
  logger(`${MODULE_LABEL} | ${message}`, ...data);
};
const logError = (...args) => log("error", ...args);

// User-facing labels that are reused in multiple places (Handlebars templates, tooltips,
// and log messages). Centralising them keeps the UI consistent.
const COMBAT_OPTION_LABELS = {
  allOutAttack: "All-Out Attack (+2 Dice / –2 Defence)",
  charge: "Charge (+1 Die, 2× Speed)",
  brace: "Brace (Negate Heavy trait)",
  pinning: "Pinning Attack (No damage, target tests Resolve)",
  halfCover: "Half Cover (+1 Defence)",
  fullCover: "Full Cover (+2 Defence)",
  pistolsInMelee: "Pistols In Melee (+2 DN to Ballistic Skill)",
  calledShotDisarm: "Disarm (No damage; Strength DN = half total damage)",
  disarmNoteHeading: "Disarm Reminder",
  disarmNote: "Roll damage as normal to determine the Strength DN (half the attack's total damage)."
};

const ENGAGED_TOOLTIP_LABELS = {
  aimSuppressed: "Engaged Opponent (Aim bonus suppressed)",
  shortRangeSuppressed: "Engaged Opponent (Short Range bonus suppressed)",
  rangedBlocked: "Engaged Opponent (Cannot fire non-Pistol ranged weapons)",
  targetNotEngaged: "Engaged Attacker (Targets must be engaged)"
};

const COVER_DIFFICULTY_VALUES = {
  "": 0,
  half: 1,
  full: 2
};

// Modifiers applied when attacking in different light levels. Each entry stores the
// label shown to the user as well as the ranged/melee penalty applied to the roll.
const VISION_PENALTIES = {
  twilight: { label: "Vision: Twilight, Light Shadows, Heavy Mist (+1 DN Ranged / +0 DN Melee)", ranged: 1, melee: 0 },
  dim: {      label: "Vision: Very Dim Light, Heavy Rain, Fog, Drifting Smoke (+2 DN Ranged / +1 DN Melee)", ranged: 2, melee: 1 },
  heavy: {    label: "Vision: Heavy Fog, Deployed Smoke, Torrential Storm (+3 DN Ranged / +2 DN Melee)", ranged: 3, melee: 2 },
  darkness: { label: "Vision: Total Darkness, Thermal Smoke (+4 DN Ranged / +3 DN Melee)", ranged: 4, melee: 3 }
};

// Size-based modifiers declared in the rules. Positive `pool` values add dice while
// `difficulty` entries increase the DN (target number). "Average" is represented by a
// zero-modifier entry to simplify the application logic later.
const SIZE_MODIFIER_OPTIONS = {
  tiny:        { label: "Tiny Target (+2 DN)", difficulty: 2 },
  small:       { label: "Small Target (+1 DN)", difficulty: 1 },
  average:     { label: "Average Target (No modifier)" },
  large:       { label: "Large Target (+1 Die)", pool: 1 },
  huge:        { label: "Huge Target (+2 Dice)", pool: 2 },
  gargantuan:  { label: "Gargantuan Target (+3 Dice)", pool: 3 }
};

// Convenience set used to verify whether a provided size string corresponds to one of
// the declared options.
const SIZE_OPTION_KEYS = new Set(Object.keys(SIZE_MODIFIER_OPTIONS));

const SIZE_ENGAGEMENT_SEQUENCE = ["tiny", "small", "average", "large", "huge", "gargantuan"];
const SIZE_AVERAGE_INDEX = SIZE_ENGAGEMENT_SEQUENCE.indexOf("average");

const ENGAGED_CONDITION_ID = "engaged";
const ENGAGED_CONDITION_FLAG_SOURCE = "auto-engaged";
const ENGAGED_CONDITION_CONFIG = {
  id: ENGAGED_CONDITION_ID,
  statuses: [ENGAGED_CONDITION_ID],
  name: "WNGCE.Condition.Engaged",
  img: "icons/skills/melee/weapons-crossed-swords-black-gray.webp"
};

const PERSISTENT_DAMAGE_CONDITIONS = {
  onfire: {
    id: "onfire",
    labelKey: "CONDITION.OnFire",
    default: { formula: "1d3" }
  },
  bleeding: {
    id: "bleeding",
    labelKey: "CONDITION.Bleeding",
    default: { amount: 1 }
  }
};

const SLOWED_CONDITIONS = [
  { id: "exhausted", labelKey: "CONDITION.Exhausted" },
  { id: "hindered", labelKey: "CONDITION.Hindered" },
  { id: "restrained", labelKey: "CONDITION.Restrained" },
  { id: "staggered", labelKey: "CONDITION.Staggered" }
];

function getActorCombatSize(actor) {
  if (!actor) return "average";
  const size = actor.system?.combat?.size ?? actor.system?.size ?? actor.size;
  return normalizeSizeKey(size);
}

function getTokenCombatSize(token) {
  if (!token) return "average";
  const actor = token.actor ?? token?.document?.actor ?? null;
  return getActorCombatSize(actor);
}

function getEngagementRangeForSize(sizeKey) {
  const index = SIZE_ENGAGEMENT_SEQUENCE.indexOf(sizeKey);
  if (index === -1 || SIZE_AVERAGE_INDEX === -1) return 1;
  return 1 + Math.max(0, index - SIZE_AVERAGE_INDEX);
}

function normalizeCoverKey(value) {
  if (!value) return "";
  const key = String(value).trim().toLowerCase();
  return key === "half" || key === "full" ? key : "";
}

function getCoverDifficulty(value) {
  const key = normalizeCoverKey(value);
  return COVER_DIFFICULTY_VALUES[key] ?? 0;
}

function getCoverLabel(value) {
  const key = normalizeCoverKey(value);
  if (key === "half") return COMBAT_OPTION_LABELS.halfCover;
  if (key === "full") return COMBAT_OPTION_LABELS.fullCover;
  return null;
}

function getTokenEngagementRange(token) {
  const sizeKey = getTokenCombatSize(token);
  return getEngagementRangeForSize(sizeKey);
}

function getTokenDisposition(token) {
  if (!token) return 0;
  const documentDisposition = token.document?.disposition;
  if (typeof documentDisposition === "number") return documentDisposition;
  const placeableDisposition = token.disposition;
  if (typeof placeableDisposition === "number") return placeableDisposition;
  return 0;
}

function tokenIsDefeated(token) {
  const actor = token?.actor ?? token?.document?.actor ?? null;
  if (!actor) return false;
  return actorHasStatus(actor, "dead");
}

function getTokenRadius(token, measurement) {
  if (!token) return 0;

  const context = measurement ?? getCanvasMeasurementContext();
  const gridDistance = Number(context?.gridDistance ?? canvas?.dimensions?.distance);

  const widthUnits = Number(token.document?.width);
  const heightUnits = Number(token.document?.height);
  const hasUnitSize = (Number.isFinite(widthUnits) && widthUnits > 0)
    || (Number.isFinite(heightUnits) && heightUnits > 0);

  if (hasUnitSize && Number.isFinite(gridDistance) && gridDistance > 0) {
    const maxUnits = Math.max(
      Number.isFinite(widthUnits) ? widthUnits : 0,
      Number.isFinite(heightUnits) ? heightUnits : 0
    );
    if (maxUnits > 0) {
      return (maxUnits * gridDistance) / 2;
    }
  }

  const unitPerPixel = Number(context?.unitPerPixel);
  const widthPx = Number(token.w ?? token.width);
  const heightPx = Number(token.h ?? token.height);
  const hasPixelSize = (Number.isFinite(widthPx) && widthPx > 0)
    || (Number.isFinite(heightPx) && heightPx > 0);

  if (hasPixelSize && Number.isFinite(unitPerPixel) && unitPerPixel > 0) {
    const maxPx = Math.max(
      Number.isFinite(widthPx) ? widthPx : 0,
      Number.isFinite(heightPx) ? heightPx : 0
    );
    if (maxPx > 0) {
      return (maxPx * unitPerPixel) / 2;
    }
  }

  return 0;
}

function measureTokenDistance(tokenA, tokenB, measurement) {
  if (!tokenA || !tokenB) return Infinity;
  const context = measurement ?? getCanvasMeasurementContext();
  const unitPerPixel = context?.unitPerPixel;

  const centerA = tokenA.center;
  const centerB = tokenB.center;

  if (unitPerPixel && centerA && centerB) {
    const dx = Number(centerA.x) - Number(centerB.x);
    const dy = Number(centerA.y) - Number(centerB.y);
    if (Number.isFinite(dx) && Number.isFinite(dy)) {
      const distancePx = Math.hypot(dx, dy);
      if (Number.isFinite(distancePx)) {
        return distancePx * unitPerPixel;
      }
    }
  }

  const grid = canvas?.grid;
  if (!grid) return Infinity;
  if (!centerA || !centerB) return Infinity;
  if (typeof Ray !== "function") return Infinity;

  try {
    const ray = new Ray(centerA, centerB);
    const distances = grid.measureDistances([{ ray }], { gridSpaces: false });
    const value = distances?.[0];
    return Number.isFinite(value) ? value : Infinity;
  } catch (err) {
    logError("Failed to measure token distance", err);
    return Infinity;
  }
}

function measureTokenEdgeDistance(tokenA, tokenB, measurement) {
  if (!tokenA || !tokenB) return Infinity;

  const context = measurement ?? getCanvasMeasurementContext();
  const unitPerPixel = Number(context?.unitPerPixel);

  const boundsA = tokenA.bounds ?? tokenA.getBounds?.();
  const boundsB = tokenB.bounds ?? tokenB.getBounds?.();

  if (boundsA && boundsB && Number.isFinite(unitPerPixel) && unitPerPixel > 0) {
    const gapRight = boundsB.x - (boundsA.x + boundsA.width);
    const gapLeft = boundsA.x - (boundsB.x + boundsB.width);
    const gapTop = boundsA.y - (boundsB.y + boundsB.height);
    const gapBottom = boundsB.y - (boundsA.y + boundsA.height);

    const dx = Math.max(0, gapRight, gapLeft);
    const dy = Math.max(0, gapTop, gapBottom);

    const distancePx = Math.hypot(dx, dy);
    if (Number.isFinite(distancePx)) {
      return distancePx * unitPerPixel;
    }
  }

  const centerDistance = measureTokenDistance(tokenA, tokenB, context);
  if (!Number.isFinite(centerDistance)) return Infinity;

  const radiusA = getTokenRadius(tokenA, context);
  const radiusB = getTokenRadius(tokenB, context);
  const radiusSum = (Number.isFinite(radiusA) ? radiusA : 0) + (Number.isFinite(radiusB) ? radiusB : 0);
  const edgeDistance = centerDistance - radiusSum;

  if (!Number.isFinite(edgeDistance)) return Infinity;
  return edgeDistance > 0 ? edgeDistance : 0;
}

function tokensAreEngaged(tokenA, tokenB, measurement) {
  if (!tokenA || !tokenB) return false;

  const context = measurement ?? getCanvasMeasurementContext();

  const threshold = Math.max(getTokenEngagementRange(tokenA), getTokenEngagementRange(tokenB));
  if (!Number.isFinite(threshold) || threshold < 0) return false;

  const distance = measureTokenEdgeDistance(tokenA, tokenB, context);
  if (!Number.isFinite(distance)) return false;

  return distance <= threshold;
}

function getCanvasMeasurementContext() {
  const dimensions = canvas?.dimensions;
  if (!dimensions) return null;

  const distance = Number(dimensions.distance);
  const size = Number(dimensions.size);
  if (!Number.isFinite(distance) || !Number.isFinite(size) || distance <= 0 || size <= 0) {
    return null;
  }

  const unitPerPixel = distance / size;
  if (!Number.isFinite(unitPerPixel) || unitPerPixel <= 0) {
    return null;
  }

  const pxPerUnit = 1 / unitPerPixel;
  if (!Number.isFinite(pxPerUnit) || pxPerUnit <= 0) {
    return null;
  }

  return {
    unitPerPixel,
    pxPerUnit,
    bucketSizePx: size,
    gridDistance: distance
  };
}

function buildEngagementTokenData(token, measurement) {
  if (!token?.id) return null;
  const center = token.center;
  if (!center) return null;

  const x = Number(center.x);
  const y = Number(center.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const range = getTokenEngagementRange(token);
  const rawRangePx = measurement?.pxPerUnit ? range * measurement.pxPerUnit : null;
  const rangePx = Number.isFinite(rawRangePx) && rawRangePx >= 0 ? rawRangePx : null;

  const radius = getTokenRadius(token, measurement);
  const rawRadiusPx = measurement?.pxPerUnit ? radius * measurement.pxPerUnit : null;
  const radiusPx = Number.isFinite(rawRadiusPx) && rawRadiusPx >= 0 ? rawRadiusPx : null;

  const bucketSizePx = measurement?.bucketSizePx;
  const bucketX = bucketSizePx ? Math.floor(x / bucketSizePx) : null;
  const bucketY = bucketSizePx ? Math.floor(y / bucketSizePx) : null;

  return {
    token,
    id: token.id,
    x,
    y,
    range,
    rangePx,
    radius,
    radiusPx,
    bucketX: Number.isFinite(bucketX) ? bucketX : null,
    bucketY: Number.isFinite(bucketY) ? bucketY : null
  };
}

function collectEngagedTokenIds(friendlyTokens, hostileTokens, measurement) {
  const engagedTokenIds = new Set();
  if (!friendlyTokens.length || !hostileTokens.length) return engagedTokenIds;

  const friendlyData = friendlyTokens
    .map((token) => buildEngagementTokenData(token, measurement))
    .filter(Boolean);
  const hostileData = hostileTokens
    .map((token) => buildEngagementTokenData(token, measurement))
    .filter(Boolean);

  if (!friendlyData.length || !hostileData.length) {
    return engagedTokenIds;
  }

  const canBucket = Boolean(measurement?.pxPerUnit && measurement?.bucketSizePx);
  const friendBucketed = canBucket && friendlyData.every((entry) => Number.isFinite(entry.bucketX) && Number.isFinite(entry.bucketY));
  const hostileBucketed = canBucket && hostileData.every((entry) => Number.isFinite(entry.bucketX) && Number.isFinite(entry.bucketY));

  if (friendBucketed && hostileBucketed) {
    const bucketSizePx = measurement.bucketSizePx;
    const pxPerUnit = measurement.pxPerUnit;

    let maxReachPx = 0;
    let maxRadiusPx = 0;
    for (const entry of [...friendlyData, ...hostileData]) {
      const entryRangePx = Number.isFinite(entry.rangePx) ? entry.rangePx : (Number.isFinite(entry.range) ? entry.range * pxPerUnit : 0);
      const entryRadiusPx = Number.isFinite(entry.radiusPx) ? entry.radiusPx : (Number.isFinite(entry.radius) ? entry.radius * pxPerUnit : 0);

      if (Number.isFinite(entryRadiusPx) && entryRadiusPx > maxRadiusPx) {
        maxRadiusPx = entryRadiusPx;
      }

      const reachPx = (Number.isFinite(entryRangePx) ? entryRangePx : 0) + (Number.isFinite(entryRadiusPx) ? entryRadiusPx : 0);
      if (Number.isFinite(reachPx) && reachPx > maxReachPx) {
        maxReachPx = reachPx;
      }
    }

    const bucketRadius = Math.max(0, Math.ceil((maxReachPx + maxRadiusPx) / bucketSizePx));
    const hostileBuckets = new Map();

    for (const hostile of hostileData) {
      const key = `${hostile.bucketX},${hostile.bucketY}`;
      const bucket = hostileBuckets.get(key);
      if (bucket) {
        bucket.push(hostile);
      } else {
        hostileBuckets.set(key, [hostile]);
      }
    }

    for (const friendly of friendlyData) {
      for (let bx = friendly.bucketX - bucketRadius; bx <= friendly.bucketX + bucketRadius; bx++) {
        for (let by = friendly.bucketY - bucketRadius; by <= friendly.bucketY + bucketRadius; by++) {
          const candidates = hostileBuckets.get(`${bx},${by}`);
          if (!candidates?.length) continue;

          for (const hostile of candidates) {
            const baseThreshold = Math.max(friendly.range, hostile.range);
            if (!Number.isFinite(baseThreshold) || baseThreshold < 0) continue;

            const expandedThreshold = baseThreshold
              + (Number.isFinite(friendly.radius) ? friendly.radius : 0)
              + (Number.isFinite(hostile.radius) ? hostile.radius : 0);
            if (!Number.isFinite(expandedThreshold) || expandedThreshold <= 0) continue;

            const thresholdPx = expandedThreshold * pxPerUnit;
            const dx = hostile.x - friendly.x;
            const dy = hostile.y - friendly.y;

            if (Math.abs(dx) > thresholdPx || Math.abs(dy) > thresholdPx) continue;
            if ((dx * dx + dy * dy) > (thresholdPx * thresholdPx)) continue;

            if (!tokensAreEngaged(friendly.token, hostile.token, measurement)) continue;

            engagedTokenIds.add(friendly.id);
            engagedTokenIds.add(hostile.id);
          }
        }
      }
    }

    if (engagedTokenIds.size) {
      return engagedTokenIds;
    }
  }

  for (const friendly of friendlyData) {
    for (const hostile of hostileData) {
      if (tokensAreEngaged(friendly.token, hostile.token, measurement)) {
        engagedTokenIds.add(friendly.id);
        engagedTokenIds.add(hostile.id);
      }
    }
  }

  return engagedTokenIds;
}

function getActorIdentifier(actor, token = null) {
  if (actor?.id) return actor.id;
  if (actor?.uuid) return actor.uuid;
  if (token?.id) return token.id;
  return null;
}

function getEngagedEffect(actor) {
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

function normalizeSizeKey(size) {
  if (!size) return "average";
  const key = String(size).trim().toLowerCase();
  if (!key) return "average";
  return SIZE_OPTION_KEYS.has(key) ? key : "average";
}

// Determine the default target size based on the first selected target. The method reads
// the actor's combat size when available and gracefully falls back to token data.
function getTargetSize(dialog) {
  const target = dialog?.data?.targets?.[0];
  const actor = target?.actor ?? target?.document?.actor;
  if (!actor) return "average";

  const size = actor.system?.combat?.size ?? actor.system?.size ?? actor.size;
  return normalizeSizeKey(size);
}

function getTargetResolve(dialog) {
  const target = dialog?.data?.targets?.[0];
  const actor = target?.actor ?? target?.document?.actor;
  if (!actor) return null;

  const resolveTotal = Number(foundry.utils.getProperty(actor.system, "attributes.resolve.total"));
  if (Number.isFinite(resolveTotal) && resolveTotal > 0) return resolveTotal;

  const resolveValue = Number(foundry.utils.getProperty(actor.system, "attributes.resolve.value"));
  if (Number.isFinite(resolveValue) && resolveValue > 0) return resolveValue;

  return null;
}

function getTargetIdentifier(dialog) {
  const target = dialog?.data?.targets?.[0];
  if (!target) return null;
  return target?.document?.id ?? target?.id ?? target?.token?.id ?? null;
}

function resolvePlaceableToken(tokenLike, { requireActiveScene = false } = {}) {
  if (!tokenLike) return null;

  let token = null;
  if (tokenLike.center && tokenLike.document) {
    token = tokenLike;
  } else if (tokenLike.object?.center && tokenLike.object?.document) {
    token = tokenLike.object;
  } else if (tokenLike.document?.object?.center && tokenLike.document?.object?.document) {
    token = tokenLike.document.object;
  } else if (tokenLike.token) {
    token = resolvePlaceableToken(tokenLike.token, { requireActiveScene: false });
  }

  if (!token) return null;

  if (requireActiveScene) {
    const sceneRef = token.scene ?? token.document?.parent ?? token.parent ?? null;
    if (sceneRef && !isActiveScene(sceneRef)) return null;
  }

  return token;
}

function getDialogAttackerToken(dialog) {
  if (!dialog) return null;

  const directToken = resolvePlaceableToken(dialog.token, { requireActiveScene: true });
  if (directToken) return directToken;

  const actor = dialog.actor ?? dialog.token?.actor ?? null;
  if (!actor) return null;

  const activeTokens = typeof actor.getActiveTokens === "function"
    ? actor.getActiveTokens(true)
    : [];

  for (const candidate of activeTokens) {
    const resolved = resolvePlaceableToken(candidate, { requireActiveScene: true });
    if (resolved) return resolved;
  }

  return null;
}

function getDialogTargetTokens(dialog) {
  const targets = Array.isArray(dialog?.data?.targets) ? dialog.data.targets : [];
  if (!targets.length) return [];

  const results = [];
  const seen = new Set();

  for (const entry of targets) {
    const token = resolvePlaceableToken(entry, { requireActiveScene: true });
    if (!token) continue;

    const identifier = token.id ?? token.document?.id ?? token.document?.uuid ?? null;
    if (identifier) {
      if (seen.has(identifier)) continue;
      seen.add(identifier);
    }

    results.push(token);
  }

  return results;
}

function actorHasStatus(actor, statusId) {
  if (!actor) return false;
  if (typeof actor.hasCondition === "function") {
    return Boolean(actor.hasCondition(statusId));
  }
  if (actor.statuses?.has?.(statusId)) return true;

  const effects = actor.effects;
  if (Array.isArray(effects)) {
    return effects.some((effect) => effect?.statuses?.has?.(statusId));
  }

  return false;
}

function getTargetCover(dialog) {
  const target = dialog?.data?.targets?.[0];
  const actor = target?.actor ?? target?.document?.actor;
  if (!actor) return "";

  if (actorHasStatus(actor, "fullCover")) return "full";
  if (actorHasStatus(actor, "halfCover")) return "half";

  return "";
}

async function syncAllOutAttackCondition(actor, enabled) {
  if (!actor || game.system?.id !== "wrath-and-glory") return;

  if (enabled) {
    if (typeof actor.addCondition !== "function") return;
    try {
      await actor.addCondition("all-out-attack", { [MODULE_ID]: { source: "combat-options" } });
    } catch (err) {
      logError("Failed to add All-Out Attack condition", err);
    }
    return;
  }

  if (typeof actor.removeCondition !== "function") return;
  try {
    await actor.removeCondition("all-out-attack");
  } catch (err) {
    logError("Failed to remove All-Out Attack condition", err);
  }
}

async function removeAllOutAttackFromActor(actor) {
  if (!actor || game.system?.id !== "wrath-and-glory") return;
  if (!actorHasStatus(actor, "all-out-attack")) return;

  if (typeof actor.removeCondition === "function") {
    try {
      await actor.removeCondition("all-out-attack");
    } catch (err) {
      logError("Failed to remove All-Out Attack condition", err);
    }
    return;
  }

  const effect = actor.effects?.find?.((entry) => entry?.statuses?.has?.("all-out-attack"));
  if (effect && typeof effect.delete === "function") {
    try {
      await effect.delete();
    } catch (err) {
      logError("Failed to delete All-Out Attack effect", err);
    }
  }
}

function sanitizePersistentDamageValue(value) {
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

function extractPersistentDamageOverride(effect) {
  const systemId = game.system?.id;
  if (!effect || typeof effect.getFlag !== "function" || !systemId) return null;

  const flags = effect.getFlag(systemId, "value");
  if (flags !== undefined && flags !== null && flags !== "") {
    return flags;
  }

  if (effect.specifier !== undefined && effect.specifier !== null && effect.specifier !== "") {
    return effect.specifier;
  }

  return null;
}

async function evaluatePersistentDamage(effect, conditionConfig) {
  if (!effect || !conditionConfig) return null;

  const label = conditionConfig.labelKey ? game.i18n.localize(conditionConfig.labelKey) : (effect.name ?? conditionConfig.id);
  const override = extractPersistentDamageOverride(effect);
  let detail = null;
  let amount;

  const defaultConfig = conditionConfig.default ?? {};

  if (typeof override === "string") {
    const formula = override.trim();
    if (formula) {
      try {
        const roll = await (new Roll(formula)).evaluate({ async: true });
        amount = roll.total ?? 0;
        detail = { formula: roll.formula ?? formula, total: roll.total ?? 0 };
      } catch (err) {
        logError(`Failed to evaluate persistent damage formula "${formula}" for ${label}`, err);
        amount = defaultConfig.amount ?? 0;
      }
    }
  } else if (override !== null) {
    amount = override;
  }

  if (amount === undefined) {
    if (defaultConfig.formula) {
      try {
        const roll = await (new Roll(defaultConfig.formula)).evaluate({ async: true });
        amount = roll.total ?? 0;
        detail = { formula: roll.formula ?? defaultConfig.formula, total: roll.total ?? 0 };
      } catch (err) {
        logError(`Failed to evaluate persistent damage formula "${defaultConfig.formula}" for ${label}`, err);
        amount = defaultConfig.amount ?? 0;
      }
    } else {
      amount = defaultConfig.amount ?? 0;
    }
  }

  const normalizedAmount = sanitizePersistentDamageValue(amount);
  return {
    conditionId: conditionConfig.id,
    label,
    amount: normalizedAmount,
    detail,
    effect
  };
}

function isActivePrimaryGM() {
  if (!game?.user?.isGM) return false;
  const activeGM = game.users?.activeGM;
  if (!activeGM) return true;
  return activeGM.id === game.user.id;
}

function shouldHandlePersistentDamage() {
  return game.system?.id === "wrath-and-glory" && isActivePrimaryGM();
}

const pendingPersistentDamageCombatants = new Map();

function isTurnChangeUpdate(changed) {
  if (!changed) return false;
  return ["turn", "combatantId", "round"].some((key) => Object.prototype.hasOwnProperty.call(changed, key));
}

function markPendingPersistentDamage(combat, changed) {
  if (!combat || !isTurnChangeUpdate(changed)) return;
  const currentCombatant = combat.combatant;
  if (!currentCombatant?.id) return;
  const actor = currentCombatant.actor;
  if (!actorHasPersistentDamage(actor)) return;
  pendingPersistentDamageCombatants.set(combat.id, currentCombatant.id);
}

function actorHasPersistentDamage(actor) {
  if (!actor || typeof actor.hasCondition !== "function") return false;
  return Object.values(PERSISTENT_DAMAGE_CONDITIONS).some((config) => actor.hasCondition(config.id));
}

function promptPendingPersistentDamage(combat) {
  if (!combat) return;
  const pendingId = pendingPersistentDamageCombatants.get(combat.id);
  if (!pendingId) return;
  pendingPersistentDamageCombatants.delete(combat.id);

  const previousCombatant = typeof combat.combatants?.get === "function"
    ? combat.combatants.get(pendingId)
    : combat.combatants?.find?.((c) => c?.id === pendingId);

  if (!previousCombatant) return;

  const maybePromise = promptPersistentDamageAtTurnEnd(previousCombatant);
  if (maybePromise?.catch) {
    maybePromise.catch((err) => logError("Failed to prompt for persistent damage", err));
  }
}

function cleanupPendingPersistentDamageForCombat(combatId) {
  if (!combatId) return;
  pendingPersistentDamageCombatants.delete(combatId);
}

function cleanupPendingPersistentDamageForCombatant(combatant) {
  const parentCombat = combatant?.parent;
  const combatId = parentCombat?.id;
  if (!combatId) return;

  const pendingId = pendingPersistentDamageCombatants.get(combatId);
  if (pendingId && pendingId === combatant.id) {
    pendingPersistentDamageCombatants.delete(combatId);
  }
}

async function promptPersistentDamageAtTurnEnd(combatant) {
  const actor = combatant?.actor;
  if (!actor || typeof actor.hasCondition !== "function") return;

  const entries = [];
  for (const key of Object.keys(PERSISTENT_DAMAGE_CONDITIONS)) {
    const config = PERSISTENT_DAMAGE_CONDITIONS[key];
    const effect = actor.hasCondition(config.id);
    if (!effect) continue;
    const evaluation = await evaluatePersistentDamage(effect, config);
    if (evaluation) entries.push(evaluation);
  }

  if (!entries.length) return;

  const total = sanitizePersistentDamageValue(entries.reduce((sum, entry) => sum + (entry?.amount ?? 0), 0));
  const listItems = entries.map((entry) => {
    const label = foundry.utils.escapeHTML(entry.label ?? entry.conditionId);
    if (entry.detail && entry.detail.formula) {
      const formula = foundry.utils.escapeHTML(String(entry.detail.formula));
      const result = foundry.utils.escapeHTML(String(entry.detail.total ?? entry.amount));
      return `<li>${game.i18n.format("WNG.PersistentDamage.SourceLineWithFormula", { condition: label, amount: entry.amount, formula, result })}</li>`;
    }
    return `<li>${game.i18n.format("WNG.PersistentDamage.SourceLine", { condition: label, amount: entry.amount })}</li>`;
  }).join("");

  const content = `
    <p>${game.i18n.format("WNG.PersistentDamage.DialogBody", { name: foundry.utils.escapeHTML(actor.name ?? combatant.name ?? "") })}</p>
    <ul>${listItems}</ul>
    <div class="form-group">
      <label>${game.i18n.localize("WNG.PersistentDamage.TotalLabel")}</label>
      <input type="number" name="persistent-damage" value="${total}" min="0" step="1" />
    </div>
    <p class="notes">${game.i18n.localize("WNG.PersistentDamage.ModifyHint")}</p>
  `;

  const activeTokens = typeof actor.getActiveTokens === "function" ? actor.getActiveTokens() : [];
  const combatantToken = combatant.token ?? null;
  const tokenDocument = combatantToken ?? activeTokens[0]?.document ?? null;
  const tokenObject = combatantToken?.object ?? activeTokens[0] ?? null;
  const tokenForActions = tokenObject ?? tokenDocument ?? undefined;
  const speakerData = { actor, token: tokenObject ?? tokenDocument ?? undefined };

  new Dialog({
    title: game.i18n.localize("WNG.PersistentDamage.DialogTitle"),
    content,
    buttons: {
      apply: {
        label: game.i18n.localize("WNG.PersistentDamage.Apply"),
        icon: "<i class=\"fas fa-burn\"></i>",
        callback: async (html) => {
          const element = html instanceof jQuery ? html[0] : html;
          const input = element?.querySelector?.('[name="persistent-damage"]') ?? (html instanceof jQuery ? html.find('[name="persistent-damage"]').get(0) : null);
          const value = input?.value ?? input?.dataset?.value;
          const mortal = sanitizePersistentDamageValue(value ?? total);
          if (mortal <= 0) return;

          const report = await actor.applyDamage(0, { mortal }, { token: tokenForActions });
          if (!report) return;

          const tooltip = report.breakdown ?? "";
          const fallbackName = foundry.utils.escapeHTML(actor.name ?? combatant.name ?? "");
          const message = report.message ?? game.i18n.format("WNG.PersistentDamage.ChatFallback", { name: fallbackName, amount: mortal });
          await ChatMessage.create({
            content: `<p data-tooltip-direction="LEFT" data-tooltip="${tooltip}">${message}</p>`,
            speaker: ChatMessage.getSpeaker(speakerData) ?? undefined,
            flags: {
              [MODULE_ID]: {
                persistentDamage: true,
                conditions: entries.map((entry) => entry.conditionId)
              }
            }
          });
        }
      },
      skip: {
        label: game.i18n.localize("WNG.PersistentDamage.Skip"),
        icon: "<i class=\"fas fa-times\"></i>"
      }
    },
    default: "apply"
  }).render(true);
}

function shouldNotifySlowedConditions() {
  return game.system?.id === "wrath-and-glory" && isActivePrimaryGM();
}

function collectSlowedConditions(actor) {
  if (!actor || typeof actor.hasCondition !== "function") return [];

  const active = [];
  for (const config of SLOWED_CONDITIONS) {
    if (!config?.id) continue;
    const effect = actor.hasCondition(config.id);
    if (!effect) continue;

    const label = config.labelKey ? game.i18n.localize(config.labelKey) : config.id;
    active.push({ id: config.id, label });
  }

  return active;
}

function formatLocalizedList(items) {
  if (!Array.isArray(items) || !items.length) return "";

  if (typeof Intl?.ListFormat === "function") {
    try {
      const formatter = new Intl.ListFormat(game?.i18n?.lang ?? "en", { style: "long", type: "conjunction" });
      return formatter.format(items);
    } catch (err) {
      // Browsers without Intl.ListFormat support fall back to the manual branch below.
    }
  }

  if (items.length === 1) return items[0];
  if (items.length === 2) {
    const conjunction = game?.i18n?.localize?.("WNG.Common.And") ?? "and";
    return `${items[0]} ${conjunction} ${items[1]}`;
  }

  const conjunction = game?.i18n?.localize?.("WNG.Common.And") ?? "and";
  const head = items.slice(0, -1).join(", ");
  const tail = items[items.length - 1];
  return `${head}, ${conjunction} ${tail}`;
}

function getSlowedNotificationRecipients(actor) {
  if (!actor) return [];

  const users = Array.isArray(game?.users) ? game.users : [];
  const canTestPermission = typeof actor.testUserPermission === "function";
  const recipients = new Set();

  for (const user of users) {
    if (!user) continue;
    if (user.isGM) {
      recipients.add(user.id);
      continue;
    }

    if (!canTestPermission) continue;
    try {
      if (actor.testUserPermission(user, "OWNER")) {
        recipients.add(user.id);
      }
    } catch (err) {
      logError("Failed to evaluate slowed condition permissions", err);
    }
  }

  return Array.from(recipients);
}

function notifySlowedConditions(combat) {
  if (!shouldNotifySlowedConditions()) return;
  const combatant = combat?.combatant;
  const actor = combatant?.actor;
  if (!actor) return;

  const slowedConditions = collectSlowedConditions(actor);
  if (!slowedConditions.length) return;

  const rawName = actor.name ?? combatant.name ?? game.i18n.localize("WNG.SlowedConditions.UnknownName");
  const safeName = foundry.utils.escapeHTML(rawName);
  const conditionLabels = slowedConditions.map((entry) => foundry.utils.escapeHTML(entry.label ?? entry.id));
  const conditionsText = formatLocalizedList(conditionLabels);

  const activeTokens = typeof actor.getActiveTokens === "function" ? actor.getActiveTokens() : [];
  const combatantToken = combatant.token ?? null;
  const tokenDocument = combatantToken ?? activeTokens[0]?.document ?? null;
  const tokenObject = combatantToken?.object ?? activeTokens[0] ?? null;
  const speakerData = {
    actor,
    token: tokenObject ?? tokenDocument ?? undefined,
    scene: combat?.scene?.id ?? tokenDocument?.parent?.id
  };

  const message = game.i18n.format("WNG.SlowedConditions.ChatReminder", {
    name: safeName,
    conditions: conditionsText
  });

  const recipients = getSlowedNotificationRecipients(actor);
  const messageData = {
    content: `<p>${message}</p>`,
    speaker: ChatMessage.getSpeaker(speakerData) ?? undefined,
    flags: {
      [MODULE_ID]: {
        slowedReminder: true,
        conditions: slowedConditions.map((entry) => entry.id)
      }
    }
  };

  if (recipients.length) {
    messageData.whisper = recipients;
  }

  const maybePromise = ChatMessage.create(messageData);
  if (maybePromise?.catch) {
    maybePromise.catch((err) => logError("Failed to create slowed reminder chat message", err));
  }
}

Hooks.on("preUpdateCombat", (combat, changed) => {
  if (!shouldHandlePersistentDamage()) return;
  markPendingPersistentDamage(combat, changed);
});

Hooks.on("combatTurn", (combat) => {
  notifySlowedConditions(combat);
  if (!shouldHandlePersistentDamage()) return;
  promptPendingPersistentDamage(combat);
});

Hooks.on("updateCombat", (combat, changed) => {
  if (!shouldHandlePersistentDamage() || !isTurnChangeUpdate(changed)) return;
  promptPendingPersistentDamage(combat);
});

Hooks.on("deleteCombat", async (combat) => {
  cleanupPendingPersistentDamageForCombat(combat?.id);
  if (game.system?.id === "wrath-and-glory") {
    const combatants = combat?.combatants ?? [];
    for (const combatant of combatants) {
      await removeAllOutAttackFromActor(combatant?.actor);
    }
  }
});

Hooks.on("deleteCombatant", async (combatant) => {
  cleanupPendingPersistentDamageForCombatant(combatant);
  if (game.system?.id === "wrath-and-glory") {
    await removeAllOutAttackFromActor(combatant?.actor);
  }
});

Hooks.on("combatTurn", async (combat) => {
  if (game.system?.id !== "wrath-and-glory") return;
  const actor = combat?.combatant?.actor;
  await removeAllOutAttackFromActor(actor);
});

Hooks.once("init", async () => {
  // Preload templates to avoid render-time disk access. Foundry caches the compiled
  // templates which gives us a small performance boost during gameplay.
  await loadTemplates([
    `${TEMPLATE_BASE_PATH}/combat-options.hbs`,
    `${TEMPLATE_BASE_PATH}/partials/co-checkbox.hbs`,
    `${TEMPLATE_BASE_PATH}/partials/co-select.hbs`
  ]);

  // Register partials manually because this file can be executed before the template
  // cache is populated. Doing this here guarantees the helpers exist when the dialog is
  // rendered.
  Handlebars.registerPartial("co-checkbox", await fetch(`${TEMPLATE_BASE_PATH}/partials/co-checkbox.hbs`).then(r => r.text()));
  Handlebars.registerPartial("co-select", await fetch(`${TEMPLATE_BASE_PATH}/partials/co-select.hbs`).then(r => r.text()));

  // Quality-of-life helpers used by the templates. `concat` mimics the helper available
  // in the core Foundry templates.
  Handlebars.registerHelper("t", (s) => String(s));
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("not", (v) => !v);
  Handlebars.registerHelper("concat", (...a) => a.slice(0, -1).join(""));
});

const patchedWeaponDialogPrototypes = new WeakSet();

// Ensure the weapon dialog prototype is patched only once. Foundry creates several
// dialog instances that share a prototype, so applying the mixins to the prototype is
// significantly cheaper than wrapping every new instance individually.
function ensureWeaponDialogPatched(app) {
  const prototype = app?.constructor?.prototype ?? Object.getPrototypeOf(app);
  if (!prototype || prototype === Application.prototype) return false;
  if (patchedWeaponDialogPrototypes.has(prototype)) return false;

  const originalPrepareContext = prototype._prepareContext;
  const originalDefaultFields  = prototype._defaultFields;
  const originalComputeFields  = prototype.computeFields;

  if (typeof originalPrepareContext !== "function" ||
      typeof originalDefaultFields  !== "function" ||
      typeof originalComputeFields  !== "function") {
    logError("WeaponDialog prototype missing expected methods");
    return false;
  }

  // Inject our computed options into the rendering context. The returned object is passed
  // directly to the Handlebars template when the dialog renders.
  prototype._prepareContext = async function (options) {
    const context = await originalPrepareContext.call(this, options);

    context.coverOptions = {
      "": "No Cover",
      half: COMBAT_OPTION_LABELS.halfCover,
      full: COMBAT_OPTION_LABELS.fullCover
    };

    const weapon = this.weapon;
    const salvoValue = Number(weapon?.system?.salvo ?? weapon?.salvo ?? 0);
    const canPinning = Boolean(weapon?.isRanged) && Number.isFinite(salvoValue) && salvoValue > 1;

    const fields = this.fields ?? (this.fields = {});
    // Clear lingering pinning values if the current weapon configuration no longer
    // supports the action (for example when switching from a ranged to a melee weapon).
    if (!canPinning && fields.pinning) {
      fields.pinning = false;
    }

    const actor = this.actor ?? this.token?.actor ?? null;
    const isEngaged = Boolean(getEngagedEffect(actor));
    const pistolTrait = weapon?.system?.traits;
    const hasPistolTrait = Boolean(pistolTrait?.has?.("pistol") || pistolTrait?.get?.("pistol"));
    const canPistolsInMelee = Boolean(isEngaged && hasPistolTrait);

    this._combatOptionsCanPistolsInMelee = canPistolsInMelee;

    if (!canPistolsInMelee && fields.pistolsInMelee) {
      fields.pistolsInMelee = false;
    }

    context.combatOptionsOpen = Boolean(
      fields.allOutAttack || fields.charging || fields.aim ||
      fields.brace || (canPinning && fields.pinning) ||
      fields.cover || fields.pistolsInMelee || fields.sizeModifier || fields.visionPenalty ||
      fields.disarm || fields.calledShot?.enabled || fields.calledShot?.size
    );

    context.hasHeavyTrait = Boolean(weapon?.system?.traits?.has?.("heavy"));
    context.canPinning = canPinning;
    return context;
  };

  // Supply neutral defaults for the extended fields. This prevents stale values from
  // lingering between dialog uses when Foundry reuses the same instance.
  prototype._defaultFields = function () {
    const defaults = originalDefaultFields.call(this) ?? {};
    return foundry.utils.mergeObject(defaults, {
      allOutAttack: false,
      brace: false,
      pinning: false,
      cover: "",
      pistolsInMelee: false,
      disarm: false,
      sizeModifier: "",
      visionPenalty: "",
      calledShot: {
        enabled: false,
        size: ""
      }
    }, { inplace: false });
  };

  // Recalculate attack statistics after toggling any combat option. The method mirrors
  // the original implementation provided by the W&G system but layers additional
  // modifiers on top of the system defaults.
  prototype.computeFields = function () {
    const fields = this.fields ?? (this.fields = {});

    const initialSnapshot = this._combatOptionsInitialFields;
    if (initialSnapshot) {
      if (initialSnapshot.pool !== undefined) fields.pool = initialSnapshot.pool;
      if (initialSnapshot.difficulty !== undefined) fields.difficulty = initialSnapshot.difficulty;
      if (initialSnapshot.damage !== undefined) fields.damage = initialSnapshot.damage;
      if (initialSnapshot.ed !== undefined) {
        fields.ed = foundry.utils.deepClone(initialSnapshot.ed);
      }
    } else {
      const damageBaseline = this._combatOptionsDamageBaseline;
      if (damageBaseline) {
        if (damageBaseline.damage !== undefined) fields.damage = damageBaseline.damage;
        if (damageBaseline.ed !== undefined) {
          fields.ed = foundry.utils.deepClone(damageBaseline.ed);
        }
      }
    }

    if (!fields.ed) fields.ed = { value: 0, dice: "" };

    this._combatOptionsDamageBaseline = {
      damage: fields.damage,
      ed: foundry.utils.deepClone(fields.ed ?? { value: 0, dice: "" })
    };

    const preCompute = {
      pool: Number(fields.pool ?? 0),
      difficulty: Number(fields.difficulty ?? 0),
      damage: fields.damage,
      ed: foundry.utils.deepClone(fields.ed ?? { value: 0, dice: "" })
    };

    // Tooltips provide a breakdown of modifiers to the end user. We temporarily disable
    // the default "Target Size" entry so that we can replace it with the recalculated
    // information after our adjustments.
    const tooltips = this.tooltips;
    let restoreTargetSizeTooltip;
    if (tooltips && typeof tooltips.finish === "function") {
      const originalFinish = tooltips.finish;
      tooltips.finish = function (...args) {
        if (args?.[1] === "Target Size") return;
        return originalFinish.apply(this, args);
      };
      restoreTargetSizeTooltip = () => { tooltips.finish = originalFinish; };
    }

    try {
      originalComputeFields.call(this);
    } finally {
      restoreTargetSizeTooltip?.();
    }

    const weapon = this.weapon;
    if (!weapon) return;

    // Helper used throughout this method to add contextual notes to Foundry's tooltip
    // summary. When tooltips are disabled the call becomes a harmless no-op.
    const addTooltip = (...args) => tooltips?.add?.(...args);

    const salvoValue = Number(weapon?.system?.salvo ?? weapon?.salvo ?? 0);
    const canPinning = Boolean(weapon?.isRanged) && Number.isFinite(salvoValue) && salvoValue > 1;
    let pinningResolve = null;
    if (typeof this._combatOptionsPinningResolve === "number" && Number.isFinite(this._combatOptionsPinningResolve)) {
      pinningResolve = Math.max(0, Math.round(this._combatOptionsPinningResolve));
      this._combatOptionsPinningResolve = pinningResolve;
    } else {
      const resolved = getTargetResolve(this);
      if (Number.isFinite(resolved)) {
        pinningResolve = Math.max(0, Math.round(resolved));
        this._combatOptionsPinningResolve = pinningResolve;
      } else {
        this._combatOptionsPinningResolve = null;
      }
    }
    if (!canPinning && fields.pinning) {
      fields.pinning = false;
    }

    // `baseSnapshot` captures the system-calculated values before any combat options are
    // applied. It allows us to reset the state if an option that modifies these fields is
    // untoggled.
    const baseSnapshot = {
      pool: Number(fields.pool ?? 0),
      difficulty: Number(fields.difficulty ?? 0),
      damage: fields.damage,
      ed: foundry.utils.deepClone(fields.ed ?? { value: 0, dice: "" })
    };

    // Determine the size modifier that should apply automatically based on the selected
    // target. Users can override this manually and the flag below remembers that choice
    // until the dialog is closed.
    const defaultSize = getTargetSize(this);
    this._combatOptionsDefaultSizeModifier = defaultSize;

    const defaultFieldValue = defaultSize === "average" ? "" : defaultSize;
    if (this._combatOptionsSizeOverride && (fields.sizeModifier ?? "") === defaultFieldValue) {
      this._combatOptionsSizeOverride = false;
    }

    if (!this._combatOptionsSizeOverride) {
      fields.sizeModifier = defaultFieldValue;
    }

    const actor = this.actor ?? this.token?.actor ?? null;
    const isEngaged = Boolean(getEngagedEffect(actor));
    const pistolTrait = weapon?.system?.traits;
    const hasPistolTrait = Boolean(pistolTrait?.has?.("pistol") || pistolTrait?.get?.("pistol"));
    const engagedWithRangedWeapon = Boolean(weapon?.isRanged && isEngaged);

    const canCheckTargets = typeof canvas !== "undefined" && canvas?.ready;
    const attackerToken = canCheckTargets ? getDialogAttackerToken(this) : null;
    const targetTokens = canCheckTargets ? getDialogTargetTokens(this) : [];

    if (isEngaged && attackerToken && targetTokens.length) {
      const measurement = getCanvasMeasurementContext();
      const hasInvalidTargets = targetTokens.some((targetToken) => !tokensAreEngaged(attackerToken, targetToken, measurement));

      if (hasInvalidTargets) {
        const currentPool = Math.max(0, Number(baseSnapshot.pool ?? 0));
        if (currentPool > 0) {
          baseSnapshot.pool = 0;
          addTooltip("pool", -currentPool, ENGAGED_TOOLTIP_LABELS.targetNotEngaged);
        } else {
          addTooltip("pool", 0, ENGAGED_TOOLTIP_LABELS.targetNotEngaged);
        }

        const currentDifficulty = Math.max(0, Number(baseSnapshot.difficulty ?? 0));
        const blockedDifficulty = Math.max(currentDifficulty, 999);
        const difficultyDelta = blockedDifficulty - currentDifficulty;
        baseSnapshot.difficulty = blockedDifficulty;
        addTooltip("difficulty", difficultyDelta, ENGAGED_TOOLTIP_LABELS.targetNotEngaged);
      }
    }

    if (engagedWithRangedWeapon) {
      if (hasPistolTrait) {
        if (fields.aim) {
          const aimBonus = Math.min(1, Math.max(0, Number(baseSnapshot.pool ?? 0)));
          if (aimBonus > 0) {
            baseSnapshot.pool = Math.max(0, Number(baseSnapshot.pool ?? 0) - aimBonus);
            addTooltip("pool", -aimBonus, ENGAGED_TOOLTIP_LABELS.aimSuppressed);
          } else {
            addTooltip("pool", 0, ENGAGED_TOOLTIP_LABELS.aimSuppressed);
          }
        }

        if ((fields.range ?? "") === "short") {
          const shortBonus = Math.min(1, Math.max(0, Number(baseSnapshot.pool ?? 0)));
          if (shortBonus > 0) {
            baseSnapshot.pool = Math.max(0, Number(baseSnapshot.pool ?? 0) - shortBonus);
            addTooltip("pool", -shortBonus, ENGAGED_TOOLTIP_LABELS.shortRangeSuppressed);
          } else {
            addTooltip("pool", 0, ENGAGED_TOOLTIP_LABELS.shortRangeSuppressed);
          }
        }
      } else {
        const currentPool = Math.max(0, Number(baseSnapshot.pool ?? 0));
        if (currentPool > 0) {
          baseSnapshot.pool = 0;
          addTooltip("pool", -currentPool, ENGAGED_TOOLTIP_LABELS.rangedBlocked);
        } else {
          addTooltip("pool", 0, ENGAGED_TOOLTIP_LABELS.rangedBlocked);
        }

        const currentDifficulty = Math.max(0, Number(baseSnapshot.difficulty ?? 0));
        const blockedDifficulty = Math.max(currentDifficulty, 999);
        const difficultyDelta = blockedDifficulty - currentDifficulty;
        baseSnapshot.difficulty = blockedDifficulty;
        addTooltip("difficulty", difficultyDelta, ENGAGED_TOOLTIP_LABELS.rangedBlocked);
      }
    }

    const baseSizeKey = this._combatOptionsSizeOverride
      ? normalizeSizeKey(fields.sizeModifier)
      : defaultSize;
    const baseSizeModifier = SIZE_MODIFIER_OPTIONS[baseSizeKey];
    if (baseSizeModifier) {
      if (baseSizeModifier.pool) {
        baseSnapshot.pool = Math.max(0, Number(baseSnapshot.pool ?? 0) - baseSizeModifier.pool);
      }
      if (baseSizeModifier.difficulty) {
        baseSnapshot.difficulty = Math.max(0, Number(baseSnapshot.difficulty ?? 0) - baseSizeModifier.difficulty);
      }
    }

    this._combatOptionsInitialFields = foundry.utils.deepClone(preCompute);
    this._combatOptionsBaseFields = foundry.utils.deepClone(baseSnapshot);

    fields.pool = baseSnapshot.pool;
    fields.difficulty = baseSnapshot.difficulty;
    fields.damage = baseSnapshot.damage;
    fields.ed = foundry.utils.deepClone(baseSnapshot.ed ?? { value: 0, dice: "" });
    if (!fields.ed) fields.ed = { value: 0, dice: "" };

    const baseDamage  = fields.damage;
    const baseEdValue = Number(fields.ed?.value ?? 0);
    const baseEdDice  = fields.ed?.dice ?? "";
    let damageSuppressed = false;

    // Melee-specific options. These generally add dice or provide bookkeeping-only
    // reminders to the tooltip log.
    if (weapon?.isMelee) {
      if (fields.allOutAttack) {
        fields.pool += 2;
        addTooltip("pool", 2, COMBAT_OPTION_LABELS.allOutAttack);
      }
    }

    // Ranged-specific options including bracing, suppressive fire, and pistol penalties
    // when firing in melee.
    if (weapon?.isRanged) {
      if (fields.brace) {
        const heavyTrait = weapon.system?.traits?.get?.("heavy") ?? weapon.system?.traits?.has?.("heavy");
        const heavyRating = Number(heavyTrait?.rating ?? heavyTrait?.value ?? 0);
        const actorStrength = this.actor?.system?.attributes?.strength?.total ?? 0;

        if (heavyTrait && Number.isFinite(heavyRating) && heavyRating > 0 && actorStrength < heavyRating) {
          fields.difficulty = Math.max(fields.difficulty - 2, 0);
          addTooltip("difficulty", -2, COMBAT_OPTION_LABELS.brace);
        } else {
          addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.brace);
        }
      }

      if (canPinning && fields.pinning) {
        if (baseDamage) addTooltip("damage", -baseDamage, COMBAT_OPTION_LABELS.pinning);
        const previousDifficulty = Number(fields.difficulty ?? 0);
        if (Number.isFinite(pinningResolve)) {
          const resolvedDifficulty = Math.max(0, pinningResolve);
          fields.difficulty = resolvedDifficulty;
          const difficultyDelta = resolvedDifficulty - previousDifficulty;
          const resolveLabel = `${COMBAT_OPTION_LABELS.pinning} (Resolve DN ${resolvedDifficulty})`;
          addTooltip("difficulty", difficultyDelta, resolveLabel);
        } else {
          addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.pinning);
        }
        fields.damage = 0;
        fields.ed.value = 0;
        fields.ed.dice = "";
        damageSuppressed = true;
      }

      if (fields.pistolsInMelee) {
        const pistolTrait = weapon.system?.traits;
        const hasPistolTrait = Boolean(pistolTrait?.has?.("pistol") || pistolTrait?.get?.("pistol"));

        let allowPistolPenalty = hasPistolTrait;
        if (allowPistolPenalty) {
          if (typeof this._combatOptionsCanPistolsInMelee === "boolean") {
            allowPistolPenalty = this._combatOptionsCanPistolsInMelee;
          } else {
            const actor = this.actor ?? this.token?.actor ?? null;
            allowPistolPenalty = Boolean(getEngagedEffect(actor));
          }
        }

        if (allowPistolPenalty) {
          fields.difficulty += 2;
          addTooltip("difficulty", 2, COMBAT_OPTION_LABELS.pistolsInMelee);
        } else {
          fields.pistolsInMelee = false;
        }
      }
    }

    const visionKey = fields.visionPenalty;
    const visionPenalty = VISION_PENALTIES[visionKey];
    if (visionPenalty) {
      const penalty = weapon?.isMelee ? visionPenalty.melee : visionPenalty.ranged;
      if (penalty > 0) fields.difficulty += penalty;
      addTooltip("difficulty", penalty ?? 0, visionPenalty.label);
    }

    const sizeKey = fields.sizeModifier;
    const sizeModifier = SIZE_MODIFIER_OPTIONS[sizeKey];
    if (sizeModifier) {
      if (sizeModifier.pool) {
        fields.pool += sizeModifier.pool;
        addTooltip("pool", sizeModifier.pool, sizeModifier.label);
      }
      if (sizeModifier.difficulty) {
        fields.difficulty += sizeModifier.difficulty;
        addTooltip("difficulty", sizeModifier.difficulty, sizeModifier.label);
      }
    }

    if (fields.disarm) {
      if (baseDamage) addTooltip("damage", -baseDamage, COMBAT_OPTION_LABELS.calledShotDisarm);
      addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.calledShotDisarm);
      fields.damage = 0;
      fields.ed.value = 0;
      fields.ed.dice = "";
      damageSuppressed = true;
    }

    const statusCover = normalizeCoverKey(this._combatOptionsDefaultCover ?? getTargetCover(this));
    const selectedCover = normalizeCoverKey(fields.cover);
    const coverDelta = getCoverDifficulty(selectedCover) - getCoverDifficulty(statusCover);

    if (coverDelta !== 0) {
      fields.difficulty += coverDelta;
      const label = getCoverLabel(coverDelta > 0 ? selectedCover : statusCover);
      if (label) addTooltip("difficulty", coverDelta, label);
    }

    // Restore the weapon's base damage dice if no option has explicitly zeroed them out.
    if (!damageSuppressed) {
      fields.damage  = baseDamage;
      fields.ed.value = baseEdValue;
      fields.ed.dice  = baseEdDice;
    }

    fields.pool = Math.max(0, Number(fields.pool ?? 0));
    fields.difficulty = Math.max(0, Number(fields.difficulty ?? 0));
    fields.ed.value = Math.max(0, Number(fields.ed?.value ?? 0));
  };

  patchedWeaponDialogPrototypes.add(prototype);
  return true;
}

// Synchronise the visible form controls with the recalculated values. Foundry does not
// automatically update input elements when `fields` is mutated, so we patch them
// manually after each recomputation.
function updateVisibleFields(app, html) {
  const $html = html instanceof jQuery ? html : $(html);

  const manualFieldSelectors = [
    'input[name="pool"]',
    'input[name="difficulty"]',
    'input[name="damage"]',
    'input[name="ed.value"]',
    'input[name="ed.dice"]'
  ];
  
  const poolInput = $html.find('input[name="pool"]');
  if (poolInput.length && app.fields?.pool !== undefined) {
    poolInput.val(app.fields.pool);
  }
  
  const difficultyInput = $html.find('input[name="difficulty"]');
  if (difficultyInput.length && app.fields?.difficulty !== undefined) {
    difficultyInput.val(app.fields.difficulty);
  }
  
  const damageInput = $html.find('input[name="damage"]');
  if (damageInput.length && app.fields?.damage !== undefined) {
    damageInput.val(app.fields.damage);
  }
  
  const edValueInput = $html.find('input[name="ed.value"]');
  if (edValueInput.length && app.fields?.ed?.value !== undefined) {
    edValueInput.val(app.fields.ed.value);
  }
  
  const edDiceInput = $html.find('input[name="ed.dice"]');
  if (edDiceInput.length && app.fields?.ed?.dice !== undefined) {
    edDiceInput.val(app.fields.ed.dice);
  }

  $html.off(".combatOptionsManual");
  $html.on(`change.combatOptionsManual`, manualFieldSelectors.join(","), (ev) => {
    const el = ev.currentTarget;
    const name = el.name;
    const fields = app.fields ?? (app.fields = {});

    const value = el.type === "number" ? Number(el.value ?? 0) : el.value;
    foundry.utils.setProperty(fields, name, value);

    app._combatOptionsInitialFields = foundry.utils.deepClone({
      pool: fields.pool,
      difficulty: fields.difficulty,
      damage: fields.damage,
      ed: foundry.utils.deepClone(fields.ed ?? { value: 0, dice: "" })
    });

    app._combatOptionsBaseFields = foundry.utils.deepClone(app._combatOptionsInitialFields);
    app._combatOptionsDamageBaseline = {
      damage: fields.damage,
      ed: foundry.utils.deepClone(fields.ed ?? { value: 0, dice: "" })
    };
  });
}

// Primary entry point: whenever the system renders a weapon dialog we inject our custom
// UI and ensure the prototype is patched. From here the module reacts to user input and
// recalculates the attack fields as necessary.
Hooks.on("renderWeaponDialog", async (app, html) => {
  try {
    if (game.system.id !== "wrath-and-glory") return;

    ensureWeaponDialogPatched(app);

    const $html = html instanceof jQuery ? html : $(html);

    // Remove original controls to prevent duplicates. The module injects replacements
    // that offer the same behaviour alongside the additional modifiers.
    $html.find('.form-group').has('input[name="aim"]').remove();
    $html.find('.form-group').has('input[name="charging"]').remove();
    $html.find('.form-group').has('select[name="calledShot.size"]').remove();

    const attackSection = $html.find(".attack");
    if (!attackSection.length) return;

    // Store the initial computed values so we can reset to them. Some combat options
    // temporarily replace the base damage/ED, so we cache the pristine state to restore
    // when the option is toggled off.
    if (!app._initialFieldsComputed) {
      if (typeof app.computeInitialFields === 'function') {
        app.computeInitialFields();
      }
      app._initialFieldsComputed = true;
    }

    // Pinning is only available for ranged weapons with a Salvo value above one. The
    // check mirrors the logic in the compute step so the UI stays in sync with gameplay
    // rules.
    const salvoValue = Number(app.weapon?.system?.salvo ?? app.weapon?.salvo ?? 0);
    const canPinning = Boolean(app.weapon?.isRanged) && Number.isFinite(salvoValue) && salvoValue > 1;

    const targetResolve = getTargetResolve(app);
    const normalizedResolve = Number.isFinite(targetResolve) ? Math.max(0, Math.round(targetResolve)) : null;
    const ctx = {
      open: app._combatOptionsOpen ?? false,
      isMelee: !!app.weapon?.isMelee,
      isRanged: !!app.weapon?.isRanged,
      hasHeavy: !!app.weapon?.system?.traits?.has?.("heavy"),
      canPinning,
      pinningResolve: normalizedResolve,
      fields: foundry.utils.duplicate(app.fields ?? {}),
      labels: {
        allOutAttack: COMBAT_OPTION_LABELS.allOutAttack,
        charge: COMBAT_OPTION_LABELS.charge,
        brace: COMBAT_OPTION_LABELS.brace,
        pinning: COMBAT_OPTION_LABELS.pinning,
        cover: "Cover",
        vision: "Vision",
        size: "Target Size",
        calledShot: "Called Shot",
        calledShotSize: "Target Size",
        disarm: COMBAT_OPTION_LABELS.calledShotDisarm,
        disarmNoteHeading: COMBAT_OPTION_LABELS.disarmNoteHeading,
        disarmNote: COMBAT_OPTION_LABELS.disarmNote
      },
      coverOptions: [
        { value: "",     label: "No Cover" },
        { value: "half", label: "Half Cover (+1 DN)" },
        { value: "full", label: "Full Cover (+2 DN)" }
      ],
      visionOptions: [
        { value: "",        label: "Normal" },
        { value: "twilight",label: "Twilight (+1 DN Ranged)" },
        { value: "dim",     label: "Dim Light (+2 DN Ranged / +1 DN Melee)" },
        { value: "heavy",   label: "Heavy Fog (+3 DN Ranged / +2 DN Melee)" },
        { value: "darkness",label: "Darkness (+4 DN Ranged / +3 DN Melee)" }
      ],
      sizeOptions: [
        { value: "",           label: "Average Target (No modifier)" },
        { value: "tiny",       label: "Tiny Target (+2 DN)" },
        { value: "small",      label: "Small Target (+1 DN)" },
        { value: "large",      label: "Large Target (+1 Die)" },
        { value: "huge",       label: "Huge Target (+2 Dice)" },
        { value: "gargantuan", label: "Gargantuan Target (+3 Dice)" }
      ],
      calledShotSizes: [
        { value: "",       label: "" },
        { value: "tiny",   label: game.i18n.localize("SIZE.TINY") },
        { value: "small",  label: game.i18n.localize("SIZE.SMALL") },
        { value: "medium", label: game.i18n.localize("SIZE.MEDIUM") }
      ]
    };

    const actor = app.actor ?? app.token?.actor;
    const fields = app.fields ?? (app.fields = {});
    let shouldRecompute = false;

    let canPistolsInMelee = app._combatOptionsCanPistolsInMelee;
    if (typeof canPistolsInMelee !== "boolean") {
      const pistolTrait = app.weapon?.system?.traits;
      const hasPistolTrait = Boolean(pistolTrait?.has?.("pistol") || pistolTrait?.get?.("pistol"));
      const isEngaged = Boolean(getEngagedEffect(actor));
      canPistolsInMelee = hasPistolTrait && isEngaged;
    }
    canPistolsInMelee = Boolean(canPistolsInMelee);

    const pistolsInMeleeInput = $html.find('input[name="pistolsInMelee"]');
    if (pistolsInMeleeInput.length) {
      pistolsInMeleeInput.prop("disabled", !canPistolsInMelee);
      if (!canPistolsInMelee) {
        if (foundry.utils.getProperty(fields, "pistolsInMelee")) {
          shouldRecompute = true;
        }
        pistolsInMeleeInput.prop("checked", false);
        foundry.utils.setProperty(fields, "pistolsInMelee", false);
      }
    }

    const disableAllOutAttack = Boolean(actor?.statuses?.has?.("full-defence"));

    const previousAllOutAttack = foundry.utils.getProperty(fields, "allOutAttack");

    if (disableAllOutAttack) {
      foundry.utils.setProperty(ctx.fields, "allOutAttack", false);
      foundry.utils.setProperty(fields, "allOutAttack", false);
    }

    ctx.disableAllOutAttack = disableAllOutAttack;

    if (disableAllOutAttack && previousAllOutAttack) {
      app._combatOptionsInitialFields = undefined;
      app._combatOptionsBaseFields = undefined;
      if (typeof app.computeInitialFields === 'function') {
        app.computeInitialFields();
      }
      if (typeof app.computeFields === 'function') {
        app.computeFields();
      }
      updateVisibleFields(app, $html);
    }

    const currentTargetId = getTargetIdentifier(app);
    if (app._combatOptionsCoverTargetId !== currentTargetId) {
      app._combatOptionsCoverOverride = false;
      app._combatOptionsCoverTargetId = currentTargetId;
    }

    if (app._combatOptionsPinningResolve !== normalizedResolve) {
      app._combatOptionsPinningResolve = normalizedResolve;
      shouldRecompute = true;
    }

    const defaultCover = getTargetCover(app);
    const normalizedDefaultCover = defaultCover ?? "";
    app._combatOptionsDefaultCover = defaultCover;
    const currentCover = ctx.fields.cover ?? "";
    if (app._combatOptionsCoverOverride && currentCover === normalizedDefaultCover) {
      app._combatOptionsCoverOverride = false;
    }
    if (!app._combatOptionsCoverOverride) {
      const previousCover = (foundry.utils.getProperty(fields, "cover") ?? "");
      if (previousCover !== normalizedDefaultCover) {
        shouldRecompute = true;
      }
      ctx.fields.cover = normalizedDefaultCover;
      foundry.utils.setProperty(fields, "cover", normalizedDefaultCover);
    }

    const defaultSize = app._combatOptionsDefaultSizeModifier ?? getTargetSize(app);
    app._combatOptionsDefaultSizeModifier = defaultSize;
    const defaultFieldValue = defaultSize === "average" ? "" : defaultSize;
    if (app._combatOptionsSizeOverride && (ctx.fields.sizeModifier ?? "") === defaultFieldValue) {
      app._combatOptionsSizeOverride = false;
    }
    if (!app._combatOptionsSizeOverride) {
      ctx.fields.sizeModifier = defaultFieldValue;
      foundry.utils.setProperty(fields, "sizeModifier", defaultFieldValue);
    }

    // When the weapon cannot perform pinning attacks we proactively disable the checkbox
    // value so the UI and internal state stay aligned.
    if (!canPinning) {
      foundry.utils.setProperty(ctx.fields, "pinning", false);
    }

    const existing = attackSection.find("[data-co-root]");
    const htmlFrag = await renderTemplate(`${TEMPLATE_BASE_PATH}/combat-options.hbs`, ctx);
    if (existing.length) {
      existing.replaceWith(htmlFrag);
    } else {
      const hr = attackSection.find('hr').first();
      if (hr.length) {
        hr.before(htmlFrag);
      } else {
        attackSection.append(htmlFrag);
      }
    }

    const root = attackSection.find("[data-co-root]");
    if (!canPinning) {
      foundry.utils.setProperty(fields, "pinning", false);
    }
    // Remove any lingering listeners before wiring new ones to avoid duplicate handlers
    // when the dialog re-renders the combat options section.
    root.off(".combatOptions");

    if (shouldRecompute) {
      if (typeof app.computeFields === 'function') {
        app.computeFields();
      }
      updateVisibleFields(app, $html);
    }

    // Remember whether the section is expanded so the dialog can restore the state when
    // it is reopened during the same session.
    root.on("toggle.combatOptions", () => {
      app._combatOptionsOpen = root.prop("open");
    });

    // Delegate change events so that dynamically re-rendered controls stay wired without
    // re-attaching listeners to each element individually.
    root.on("change.combatOptions", "[data-co]", async (ev) => {
      ev.stopPropagation();
      const el = ev.currentTarget;
      const name = el.name;
      const value = el.type === "checkbox" ? el.checked : el.value;
      const fields = app.fields ?? (app.fields = {});

      foundry.utils.setProperty(fields, name, value);

      if (name === "allOutAttack" && disableAllOutAttack) {
        foundry.utils.setProperty(fields, "allOutAttack", false);
        root.find('input[name="allOutAttack"]').prop("checked", false);
        return;
      }

      // Once the player manually selects a size modifier we keep their choice instead of
      // recalculating it automatically from the target token on subsequent renders.
      if (name === "sizeModifier") {
        app._combatOptionsSizeOverride = true;
      }

      if (name === "cover") {
        app._combatOptionsCoverOverride = true;
      }

      // Toggle the visibility of the called shot sub-form so that the dialog only shows
      // the additional inputs when the option is active.
      if (name === "calledShot.enabled") {
        root.find(".combat-options__called-shot").toggleClass("is-hidden", !value);
      }

      if (name === "allOutAttack" && !disableAllOutAttack) {
        await syncAllOutAttackCondition(actor, Boolean(value));
      }

      // Force a complete recalculation so the system re-applies weapon stats before we
      // layer our modifiers on top of them.
      app._combatOptionsInitialFields = undefined;
      app._combatOptionsBaseFields = undefined;
      if (typeof app.computeInitialFields === 'function') {
        app.computeInitialFields();
      }
      if (typeof app.computeFields === 'function') {
        app.computeFields();
      }

      updateVisibleFields(app, $html);
    });

  } catch (err) {
    logError("Failed to render combat options", err);
    console.error(err);
  }
});
