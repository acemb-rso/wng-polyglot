import {
  COMBAT_OPTION_LABELS,
  COVER_DIFFICULTY_VALUES,
  ENGAGED_TOOLTIP_LABELS,
  MODULE_BASE_PATH,
  MODULE_ID,
  TEMPLATE_BASE_PATH,
  VISION_PENALTIES,
  SIZE_MODIFIER_OPTIONS,
  SIZE_OPTION_KEYS
} from "./constants.js";
import { getEngagedEffect, isActiveScene } from "./engagement.js";
import { log, logDebug, logError } from "./logging.js";
import {
  getCanvasMeasurementContext,
  getCoverDifficulty,
  getCoverLabel,
  normalizeCoverKey,
  normalizeSizeKey,
  tokensAreEngaged
} from "./measurement.js";
import { actorHasStatus, syncAllOutAttackCondition } from "./turn-effects.js";

const COMBAT_EXTENDER_SCRIPT_ID = `${MODULE_ID}.combat-extender`;

// Determine the default target size based on the first selected target. The method reads
// the actor's combat size when available and gracefully falls back to token data.
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

function combatOptionsActive(fields) {
  if (!fields) return false;

  return Boolean(
    fields.allOutAttack ||
    fields.brace ||
    fields.pinning ||
    fields.pistolsInMelee ||
    fields.disarm ||
    fields.cover ||
    fields.visionPenalty ||
    fields.sizeModifier ||
    fields.aim ||
    fields.charging ||
    fields.calledShot?.enabled
  );
}

function registerCombatExtenderDialogScript() {
  Hooks.once("init", () => {
    const registerScript = game.wng?.registerScript;
    if (typeof registerScript !== "function") {
      logDebug("game.wng.registerScript unavailable; skipping CE dialog script registration");
      return;
    }

    registerScript("dialog", {
      id: COMBAT_EXTENDER_SCRIPT_ID,
      Label: "Combat Extender",
      hide: () => false,
      activate: (dialog) => combatOptionsActive(dialog?.fields),
      submit: (dialog) => {
        dialog.flags = dialog.flags ?? {};
        dialog.flags.combatExtender = {
          delta: dialog._combatExtenderDelta ?? null,
          fields: {
            pool: Number(dialog?.fields?.pool ?? 0),
            difficulty: Number(dialog?.fields?.difficulty ?? 0),
            damage: dialog?.fields?.damage ?? 0,
            ed: {
              value: Number(dialog?.fields?.ed?.value ?? 0),
              dice: Number(dialog?.fields?.ed?.dice ?? 0)
            },
            ap: {
              value: Number(dialog?.fields?.ap?.value ?? 0),
              dice: Number(dialog?.fields?.ap?.dice ?? 0)
            }
          }
        };
      },
      script: () => {}
    });
  });
}

registerCombatExtenderDialogScript();

function getTargetCover(dialog) {
  const target = dialog?.data?.targets?.[0];
  const actor = target?.actor ?? target?.document?.actor;
  if (!actor) return "";

  if (actorHasStatus(actor, "fullCover")) return "full";
  if (actorHasStatus(actor, "halfCover")) return "half";

  return "";
}

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
  const originalGetSubmissionData = prototype._getSubmissionData;
  const originalComputeInitialFields = prototype.computeInitialFields;

  if (typeof originalPrepareContext !== "function" ||
      typeof originalDefaultFields  !== "function" ||
      typeof originalComputeFields  !== "function" ||
      typeof originalGetSubmissionData !== "function") {
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
      ed: { value: 0, dice: 0 },
      ap: { value: 0, dice: 0 },
      damage: 0,
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
  // the original implementation provided by the W&G system, lets the system compute its
  // own fields first, and then layers additional modifiers on top of those results.
  const computeFieldsWrapper = function (wrapped, ...args) {
    const weapon = this.weapon;
    if (!weapon) return wrapped?.apply(this, args);

    const tooltips = this.tooltips;
    let restoreTargetSizeTooltip;
    if (tooltips && typeof tooltips.finish === "function") {
      const originalFinish = tooltips.finish;
      tooltips.finish = function (...args) {
        // Let the system do all its normal work, but hide the old
        // Target Size tooltip so CE can present its own.
        if (args?.[1] === "Target Size") return;
        return originalFinish.apply(this, args);
      };
      restoreTargetSizeTooltip = () => { tooltips.finish = originalFinish; };
    }

    // --- 1. Let the system compute once, then snapshot the baseline ------
    try {
      // This runs the original WeaponDialog/AttackDialog computeFields,
      // including all weapon trait scripts (Red-Dot, Salvo, Sniper, etc.)
      wrapped?.apply(this, args);
    } finally {
      // Always restore the original tooltip.finish, even if something throws
      restoreTargetSizeTooltip?.();
    }

    const fields = this.fields ?? (this.fields = {});
    const systemBaseline = foundry.utils.deepClone(fields);

    // Snapshot manual overrides so we can re-apply them after CE adjustments
    const manualOverridesRaw = this._combatOptionsManualOverrides
      ? foundry.utils.deepClone(this._combatOptionsManualOverrides)
      : null;
    const manualOverrides = manualOverridesRaw && Object.keys(manualOverridesRaw).length
      ? manualOverridesRaw
      : null;

    logDebug("WeaponDialog.computeFields: captured manual overrides", {
      manualOverrides,
      systemBaseline: foundry.utils.deepClone(systemBaseline)
    });

    // Remove the previously-applied CE delta so we always compute from the fresh baseline
    const lastDelta = this._combatExtenderDelta || null;
    if (lastDelta) {
      fields.pool = Number(fields.pool ?? 0) - (lastDelta.pool ?? 0);
      fields.difficulty = Number(fields.difficulty ?? 0) - (lastDelta.difficulty ?? 0);
      fields.damage = (fields.damage ?? 0) - (lastDelta.damage ?? 0);

      if (fields.ed) {
        fields.ed.value = Number(fields.ed.value ?? 0) - (lastDelta.ed?.value ?? 0);
        fields.ed.dice = Number(fields.ed.dice ?? 0) - (lastDelta.ed?.dice ?? 0);
      }

      if (fields.ap) {
        fields.ap.value = Number(fields.ap.value ?? 0) - (lastDelta.ap?.value ?? 0);
        fields.ap.dice = Number(fields.ap.dice ?? 0) - (lastDelta.ap?.dice ?? 0);
      }
    }

    // Start from the system's output before layering CE modifiers
    fields.pool       = Number(systemBaseline.pool ?? 0);
    fields.difficulty = Number(systemBaseline.difficulty ?? 0);
    fields.damage     = systemBaseline.damage;
    fields.ed         = foundry.utils.deepClone(systemBaseline.ed ?? { value: 0, dice: 0 });
    fields.ap         = foundry.utils.deepClone(systemBaseline.ap ?? { value: 0, dice: 0 });

    // ED “pip” distribution and rollMode are always manual in the core system:
    const preservedDamageDice = foundry.utils.deepClone(fields.damageDice ?? null);
    const preservedRollMode   = fields.rollMode;

    const addTooltip = (...args) => tooltips?.add?.(...args);

    if (preservedDamageDice) fields.damageDice = preservedDamageDice;
    if (preservedRollMode !== undefined) fields.rollMode = preservedRollMode;

    // --- 4. Size resolution (default vs override) ------------------------
    const defaultSize = getTargetSize(this);
    this._combatOptionsDefaultSizeModifier = defaultSize;
    const defaultSizeFieldValue = defaultSize === "average" ? "" : defaultSize;

    if (this._combatOptionsSizeOverride && (fields.sizeModifier ?? "") === defaultSizeFieldValue) {
      this._combatOptionsSizeOverride = false;
    }
    if (!this._combatOptionsSizeOverride) {
      fields.sizeModifier = defaultSizeFieldValue;
    }

    const normalizedSizeModifier = normalizeSizeKey(
      fields.sizeModifier || defaultSizeFieldValue || defaultSize
    );
    fields.sizeModifier = normalizedSizeModifier === "average" ? "" : normalizedSizeModifier;

    // Always remove the system's built-in size modifier based on the default target size.
    // We'll re-apply the user's chosen size (if any) below.
    const baseSizeKey = normalizeSizeKey(defaultSize || "average");

    const systemAppliedSizeModifier = SIZE_MODIFIER_OPTIONS[baseSizeKey];
    if (systemAppliedSizeModifier) {
      if (systemAppliedSizeModifier.pool) {
        fields.pool = Math.max(0, fields.pool - systemAppliedSizeModifier.pool);
      }
      if (systemAppliedSizeModifier.difficulty) {
        fields.difficulty = Math.max(0, fields.difficulty - systemAppliedSizeModifier.difficulty);
      }
    }

    // --- 5. Pinning eligibility / resolve target -------------------------
    const salvoValue = Number(weapon?.system?.salvo ?? weapon?.salvo ?? 0);
    const canPinning = Boolean(weapon?.isRanged) && Number.isFinite(salvoValue) && salvoValue > 1;

    let pinningResolve = null;
    if (typeof this._combatOptionsPinningResolve === "number" &&
        Number.isFinite(this._combatOptionsPinningResolve)) {
      pinningResolve = Math.max(0, Math.round(this._combatOptionsPinningResolve));
    } else {
      const resolved = getTargetResolve(this);
      if (Number.isFinite(resolved)) {
        pinningResolve = Math.max(0, Math.round(resolved));
        this._combatOptionsPinningResolve = pinningResolve;
      }
    }

    if (!canPinning && fields.pinning) {
      fields.pinning = false;
    }

    // --- 6. Engagement & ranged restrictions -----------------------------
    const actor = this.actor ?? this.token?.actor ?? null;
    const isEngaged = Boolean(getEngagedEffect(actor));
    const pistolTrait = weapon?.system?.traits;
    const hasPistolTrait = Boolean(pistolTrait?.has?.("pistol") || pistolTrait?.get?.("pistol"));

    const canCheckTargets = typeof canvas !== "undefined" && canvas?.ready;
    const attackerToken = canCheckTargets ? getDialogAttackerToken(this) : null;
    const targetTokens  = canCheckTargets ? getDialogTargetTokens(this) : [];

    if (isEngaged && attackerToken && targetTokens.length) {
      const measurement = getCanvasMeasurementContext();
      const hasInvalidTargets = targetTokens.some((targetToken) =>
        !tokensAreEngaged(attackerToken, targetToken, measurement)
      );

      if (hasInvalidTargets) {
        const currentPool = Math.max(0, fields.pool);
        if (currentPool > 0) {
          fields.pool = 0;
          addTooltip("pool", -currentPool, ENGAGED_TOOLTIP_LABELS.targetNotEngaged);
        } else {
          addTooltip("pool", 0, ENGAGED_TOOLTIP_LABELS.targetNotEngaged);
        }

        const currentDifficulty = Math.max(0, fields.difficulty);
        const blockedDifficulty = Math.max(currentDifficulty, 999);
        fields.difficulty = blockedDifficulty;
        addTooltip("difficulty", blockedDifficulty - currentDifficulty, ENGAGED_TOOLTIP_LABELS.targetNotEngaged);
      }
    }

    const engagedWithRangedWeapon = Boolean(weapon?.isRanged && isEngaged);
    if (engagedWithRangedWeapon) {
      if (hasPistolTrait) {
        if (fields.aim) {
          const aimBonus = Math.min(1, Math.max(0, fields.pool));
          if (aimBonus > 0) {
            fields.pool = Math.max(0, fields.pool - aimBonus);
            addTooltip("pool", -aimBonus, ENGAGED_TOOLTIP_LABELS.aimSuppressed);
          } else {
            addTooltip("pool", 0, ENGAGED_TOOLTIP_LABELS.aimSuppressed);
          }
        }

        if ((fields.range ?? "") === "short") {
          const shortBonus = Math.min(1, Math.max(0, fields.pool));
          if (shortBonus > 0) {
            fields.pool = Math.max(0, fields.pool - shortBonus);
            addTooltip("pool", -shortBonus, ENGAGED_TOOLTIP_LABELS.shortRangeSuppressed);
          } else {
            addTooltip("pool", 0, ENGAGED_TOOLTIP_LABELS.shortRangeSuppressed);
          }
        }
      } else {
        const currentPool = Math.max(0, fields.pool);
        if (currentPool > 0) {
          fields.pool = 0;
          addTooltip("pool", -currentPool, ENGAGED_TOOLTIP_LABELS.rangedBlocked);
        } else {
          addTooltip("pool", 0, ENGAGED_TOOLTIP_LABELS.rangedBlocked);
        }

        const currentDifficulty = Math.max(0, fields.difficulty);
        const blockedDifficulty = Math.max(currentDifficulty, 999);
        fields.difficulty = blockedDifficulty;
        addTooltip("difficulty", blockedDifficulty - currentDifficulty, ENGAGED_TOOLTIP_LABELS.rangedBlocked);
      }
    }

    // --- 7. Base damage snapshot before “no damage” options --------------
    const baseDamage  = fields.damage;
    const baseEdValue = Number(fields.ed?.value ?? 0);
    const baseEdDice  = Number(fields.ed?.dice ?? 0);
    let damageSuppressed = false;

    // --- 8. Combat options: all-out, brace, pinning, pistols in melee ----
    if (weapon?.isMelee && fields.allOutAttack) {
      fields.pool += 2;
      addTooltip("pool", 2, COMBAT_OPTION_LABELS.allOutAttack);
    }

    if (weapon?.isRanged) {
      if (fields.brace) {
        const heavyTrait   = weapon.system?.traits?.get?.("heavy") ?? weapon.system?.traits?.has?.("heavy");
        const heavyRating  = Number(heavyTrait?.rating ?? heavyTrait?.value ?? 0);
        const actorStrength = actor?.system?.attributes?.strength?.total ?? 0;

        if (heavyTrait && Number.isFinite(heavyRating) && heavyRating > 0 && actorStrength < heavyRating) {
          fields.difficulty = Math.max(fields.difficulty - 2, 0);
          addTooltip("difficulty", -2, COMBAT_OPTION_LABELS.brace);
        } else {
          addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.brace);
        }
      }

      if (canPinning && fields.pinning) {
        if (baseDamage) addTooltip("damage", -baseDamage, COMBAT_OPTION_LABELS.pinning);

        const previousDifficulty = fields.difficulty;
        if (Number.isFinite(pinningResolve)) {
          fields.difficulty = Math.max(0, pinningResolve);
          const difficultyDelta = fields.difficulty - previousDifficulty;
          addTooltip("difficulty", difficultyDelta, `${COMBAT_OPTION_LABELS.pinning} (Resolve DN ${fields.difficulty})`);
        } else {
          addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.pinning);
        }

        fields.damage   = 0;
        fields.ed.value = 0;
        fields.ed.dice  = 0;
        damageSuppressed = true;
      }

      if (fields.pistolsInMelee) {
        let allowPistolPenalty = hasPistolTrait;
        if (allowPistolPenalty) {
          if (typeof this._combatOptionsCanPistolsInMelee === "boolean") {
            allowPistolPenalty = this._combatOptionsCanPistolsInMelee;
          } else {
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

    // --- 9. Vision penalties ---------------------------------------------
    const visionKey     = fields.visionPenalty;
    const visionPenalty = VISION_PENALTIES[visionKey];
    if (visionPenalty) {
      const penalty = weapon?.isMelee ? visionPenalty.melee : visionPenalty.ranged;
      if (penalty > 0) fields.difficulty += penalty;
      addTooltip("difficulty", penalty ?? 0, visionPenalty.label);
    }

    // --- 10. Apply size modifier (user’s choice) -------------------------
    const sizeKey     = fields.sizeModifier;
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

    // --- 11. Disarm option (no damage) -----------------------------------
    if (fields.disarm) {
      if (baseDamage) addTooltip("damage", -baseDamage, COMBAT_OPTION_LABELS.calledShotDisarm);
      addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.calledShotDisarm);
      fields.damage   = 0;
      fields.ed.value = 0;
      fields.ed.dice  = 0;
      damageSuppressed = true;
    }

    // --- 12. Cover -------------------------------------------------------
    const statusCover   = normalizeCoverKey(this._combatOptionsDefaultCover ?? getTargetCover(this));
    const selectedCover = normalizeCoverKey(fields.cover);
    const coverDelta    = getCoverDifficulty(selectedCover) - getCoverDifficulty(statusCover);

    if (coverDelta !== 0) {
      fields.difficulty += coverDelta;
      const label = getCoverLabel(coverDelta > 0 ? selectedCover : statusCover);
      if (label) addTooltip("difficulty", coverDelta, label);
    }

    // --- 13. Restore damage if not suppressed ----------------------------
    if (!damageSuppressed) {
      fields.damage   = baseDamage;
      fields.ed.value = baseEdValue;
      fields.ed.dice  = baseEdDice;
    }

    const delta = {
      pool: Number(fields.pool ?? 0) - Number(systemBaseline.pool ?? 0),
      difficulty: Number(fields.difficulty ?? 0) - Number(systemBaseline.difficulty ?? 0),
      damage: (fields.damage ?? 0) - (systemBaseline.damage ?? 0),
      ed: {
        value: Number(fields.ed?.value ?? 0) - Number(systemBaseline.ed?.value ?? 0),
        dice: Number(fields.ed?.dice ?? 0) - Number(systemBaseline.ed?.dice ?? 0)
      },
      ap: {
        value: Number(fields.ap?.value ?? 0) - Number(systemBaseline.ap?.value ?? 0),
        dice: Number(fields.ap?.dice ?? 0) - Number(systemBaseline.ap?.dice ?? 0)
      }
    };
    this._combatExtenderDelta = delta;

    // --- 14. Clamp, then re-apply manual overrides -----------------------
    if (!manualOverrides || manualOverrides.pool === undefined) {
      fields.pool = Math.max(0, Number(fields.pool ?? 0));
    }
    if (!manualOverrides || manualOverrides.difficulty === undefined) {
      fields.difficulty = Math.max(0, Number(fields.difficulty ?? 0));
    }
    if (!manualOverrides || manualOverrides.ed === undefined) {
      fields.ed.value = Math.max(0, Number(fields.ed?.value ?? 0));
      fields.ed.dice  = Math.max(0, Number(fields.ed?.dice ?? 0));
    }
    if (!manualOverrides || manualOverrides.ap === undefined) {
      fields.ap.value = Math.max(0, Number(fields.ap?.value ?? 0));
      fields.ap.dice  = Math.max(0, Number(fields.ap?.dice ?? 0));
    }
    if (!manualOverrides || manualOverrides.wrath === undefined) {
      fields.wrath = Math.max(0, Number(fields.wrath ?? 0));
    }

    if (manualOverrides) {
      logDebug("WeaponDialog.computeFields: re-applying manual overrides", manualOverrides);
      if (manualOverrides.pool !== undefined) {
        fields.pool = Math.max(0, Number(manualOverrides.pool ?? 0));
      }
      if (manualOverrides.difficulty !== undefined) {
        fields.difficulty = Math.max(0, Number(manualOverrides.difficulty ?? 0));
      }
      if (manualOverrides.damage !== undefined) {
        fields.damage = manualOverrides.damage;
      }
      if (manualOverrides.ed !== undefined) {
        fields.ed = foundry.utils.deepClone(manualOverrides.ed);
        fields.ed.value = Math.max(0, Number(fields.ed?.value ?? 0));
        fields.ed.dice  = Math.max(0, Number(fields.ed?.dice ?? 0));
      }
      if (manualOverrides.ap !== undefined) {
        fields.ap = foundry.utils.deepClone(manualOverrides.ap);
        fields.ap.value = Math.max(0, Number(fields.ap?.value ?? 0));
        fields.ap.dice  = Math.max(0, Number(fields.ap?.dice ?? 0));
      }
      if (manualOverrides.wrath !== undefined) {
        fields.wrath = Math.max(0, Number(manualOverrides.wrath ?? 0));
      }
    }
      // --- Safety: when CE is "off", trust the system baseline completely ----
    const actorForSafety = this.actor ?? this.token?.actor ?? null;
    const isEngagedForSafety = Boolean(getEngagedEffect(actorForSafety));
    const engagedRangedForSafety = Boolean(weapon?.isRanged && isEngagedForSafety);

    const hasAnyCombatOption = combatOptionsActive(fields);

    logDebug("WeaponDialog.computeFields: baseline vs final after CE", {
   baselinePool: systemBaseline.pool,
   finalPool: fields.pool,
   hasAnyCombatOption,
   engagedRangedForSafety,
   manualOverrides
   });

    if (!this._combatOptionsManualOverrides &&
        !engagedRangedForSafety &&
        !hasAnyCombatOption &&
        typeof systemBaseline.pool === "number") {
      // Return the system's own results untouched
      fields.pool       = Number(systemBaseline.pool);
      fields.difficulty = Number(systemBaseline.difficulty ?? fields.difficulty);
      fields.damage     = systemBaseline.damage;
      fields.ed         = foundry.utils.deepClone(systemBaseline.ed ?? fields.ed);
      fields.ap         = foundry.utils.deepClone(systemBaseline.ap ?? fields.ap);
    }

    return this.fields;
  };

  const constructorName = prototype?.constructor?.name;
  if (typeof libWrapper !== "undefined" && libWrapper?.register && constructorName) {
    const prototypePath = `${constructorName}.prototype.computeFields`;
    libWrapper.register(
      MODULE_ID,
      prototypePath,
      computeFieldsWrapper,
      "WRAPPER"
    );
  } else {
    logError("libWrapper missing or constructor name unavailable; cannot wrap WeaponDialog.computeFields safely");
    prototype.computeFields = function (...args) {
      return computeFieldsWrapper.call(this, originalComputeFields, ...args);
    };
  }

  // Guard against undefined targets when submitting the dialog. The system dialog
  // expects every target entry to contain an actor, but Foundry can leave
  // placeholder tokens in the list (for example when targets are cleared before
  // submission). Filter out those entries to prevent `speakerData` access errors
  // thrown by the upstream implementation.
  prototype._getSubmissionData = function () {
    const data = originalGetSubmissionData.call(this);

    if (Array.isArray(data?.targets)) {
      data.targets = data.targets
        .map((target) => {
          const actor = target?.actor ?? target?.document?.actor ?? null;
          if (!actor) return null;

          const token = target?.document ?? target?.token ?? null;
          return typeof actor.speakerData === "function"
            ? actor.speakerData(token)
            : null;
        })
        .filter(Boolean);
    }

    return data;
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
    'input[name="ed.dice"]',
    'input[name="ap.value"]',
    'input[name="ap.dice"]',
    'input[name="wrath"]' 
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

  const apValueInput = $html.find('input[name="ap.value"]');
  if (apValueInput.length && app.fields?.ap?.value !== undefined) {
    apValueInput.val(app.fields.ap.value);
  }

  const apDiceInput = $html.find('input[name="ap.dice"]');
  if (apDiceInput.length && app.fields?.ap?.dice !== undefined) {
    apDiceInput.val(app.fields.ap.dice);
  }
  
  $html.off(".combatOptionsManual");
  $html.on(`change.combatOptionsManual input.combatOptionsManual`, manualFieldSelectors.join(","), (ev) => {
    const el = ev.currentTarget;
    const name = el.name;
    const fields = app.fields ?? (app.fields = {});

    const value = el.type === "number" ? Number(el.value ?? 0) : el.value;
    foundry.utils.setProperty(fields, name, value);

    const manualSnapshot = foundry.utils.deepClone(app._combatOptionsManualOverrides ?? {});

    if (name === "pool") {
      manualSnapshot.pool = fields.pool;
    } else if (name === "difficulty") {
      manualSnapshot.difficulty = fields.difficulty;
    } else if (name === "damage") {
      manualSnapshot.damage = fields.damage;
    } else if (name.startsWith("ed.")) {
      const manualEd = foundry.utils.deepClone(manualSnapshot.ed ?? {});
      manualEd.value = Number(fields.ed?.value ?? 0);
      manualEd.dice = Number(fields.ed?.dice ?? 0);
      manualSnapshot.ed = manualEd;
    } else if (name.startsWith("ap.")) {
      const manualAp = foundry.utils.deepClone(manualSnapshot.ap ?? {});
      manualAp.value = Number(fields.ap?.value ?? 0);
      manualAp.dice = Number(fields.ap?.dice ?? 0);
      manualSnapshot.ap = manualAp;
    }
    else if (name === "wrath") {
      manualSnapshot.wrath = Number(fields.wrath ?? 0);
    }

    const hasManualOverrides = Object.keys(manualSnapshot).length > 0;
    app._combatOptionsManualOverrides = hasManualOverrides
      ? foundry.utils.deepClone(manualSnapshot)
      : null;

    logDebug("WeaponDialog: manual override snapshot updated", {
      field: name,
      manualOverrides: app._combatOptionsManualOverrides
    });
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
      if (typeof app.computeFields === 'function') {
        app.computeFields();
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
    const previousSizeModifier = ctx.fields.sizeModifier ?? "";
    if (app._combatOptionsSizeOverride && previousSizeModifier === defaultFieldValue) {
      app._combatOptionsSizeOverride = false;
    }
    if (!app._combatOptionsSizeOverride) {
      if (previousSizeModifier !== defaultFieldValue) {
        shouldRecompute = true;
      }
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

    const recomputeDialogFields = () => {
      if (typeof app.computeFields === 'function') {
        app.computeFields();
      }
    };

    if (shouldRecompute) {
      recomputeDialogFields();
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

      // Fields that may trigger weapon traits - invalidate baseline
      const traitTriggerFields = [
        "aim",
        "charging",
        "range",
        "calledShot.enabled",
        "calledShot.size"
      ];

      if (traitTriggerFields.includes(name)) {
        app._initialFieldsComputed = false;
      }

      // Force a complete recalculation so the system re-applies weapon stats before we
      // layer our modifiers on top of them.
      if (typeof app.computeFields === 'function') {
        app.computeFields();
      }

      updateVisibleFields(app, $html);
    });

    // Keep the combat calculations in sync with the system range selector. The built-in
    // selector isn't part of our data-co controls, so we need to listen for changes
    // separately and force a full recompute so the system's range modifiers are applied.
    $html.find('select[name="range"]').off(".combatOptionsRange").on("change.combatOptionsRange", () => {
      app._initialFieldsComputed = false;

      if (typeof app.computeFields === "function") {
        app.computeFields();
      }

      updateVisibleFields(app, $html);
    });

  } catch (err) {
    logError("Failed to render combat options", err);
    console.error(err);
  }
});
