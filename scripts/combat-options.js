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
  grapple: "Grapple (Opposed Strength Test)",
  fallBack: "Fall Back (Withdraw safely)",
  brace: "Brace (Negate Heavy trait)",
  pinning: "Pinning Attack (No damage, target tests Resolve)",
  halfCover: "Half Cover (+1 Defence)",
  fullCover: "Full Cover (+2 Defence)",
  pistolsInMelee: "Pistols In Melee (+2 DN to Ballistic Skill)",
  calledShotDisarm: "Disarm (No damage)"
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

Hooks.on("combatTurnEnd", (combat, combatant) => {
  if (game.system.id !== "wrath-and-glory") return;
  if (!isActivePrimaryGM()) return;
  if (!combatant) return;

  const maybePromise = promptPersistentDamageAtTurnEnd(combatant);
  if (maybePromise?.catch) {
    maybePromise.catch((err) => logError("Failed to prompt for persistent damage", err));
  }
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

    context.combatOptionsOpen = Boolean(
      fields.allOutAttack || fields.charging || fields.aim || fields.grapple ||
      fields.fallBack || fields.brace || (canPinning && fields.pinning) ||
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
      grapple: false,
      fallBack: false,
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
      if (fields.grapple)  addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.grapple);
      if (fields.fallBack) addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.fallBack);
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
        fields.damage = 0;
        fields.ed.value = 0;
        fields.ed.dice = "";
        addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.pinning);
        damageSuppressed = true;
      }

      if (fields.pistolsInMelee && weapon.system?.traits?.has?.("pistol")) {
        fields.difficulty += 2;
        addTooltip("difficulty", 2, COMBAT_OPTION_LABELS.pistolsInMelee);
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

    if (fields.cover === "half") {
      fields.difficulty += 1;
      addTooltip("difficulty", 1, COMBAT_OPTION_LABELS.halfCover);
    } else if (fields.cover === "full") {
      fields.difficulty += 2;
      addTooltip("difficulty", 2, COMBAT_OPTION_LABELS.fullCover);
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

    const ctx = {
      open: app._combatOptionsOpen ?? false,
      isMelee: !!app.weapon?.isMelee,
      isRanged: !!app.weapon?.isRanged,
      hasHeavy: !!app.weapon?.system?.traits?.has?.("heavy"),
      canPinning,
      fields: foundry.utils.duplicate(app.fields ?? {}),
      labels: {
        allOutAttack: COMBAT_OPTION_LABELS.allOutAttack,
        charge: COMBAT_OPTION_LABELS.charge,
        grapple: COMBAT_OPTION_LABELS.grapple,
        fallBack: COMBAT_OPTION_LABELS.fallBack,
        brace: COMBAT_OPTION_LABELS.brace,
        pinning: COMBAT_OPTION_LABELS.pinning,
        cover: "Cover",
        vision: "Vision",
        size: "Target Size",
        calledShot: "Called Shot",
        calledShotSize: "Target Size",
        disarm: COMBAT_OPTION_LABELS.calledShotDisarm
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
    const disableAllOutAttack = Boolean(actor?.statuses?.has?.("full-defence"));

    const previousAllOutAttack = foundry.utils.getProperty(app.fields ?? (app.fields = {}), "allOutAttack");

    if (disableAllOutAttack) {
      foundry.utils.setProperty(ctx.fields, "allOutAttack", false);
      foundry.utils.setProperty(app.fields, "allOutAttack", false);
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

    const defaultSize = app._combatOptionsDefaultSizeModifier ?? getTargetSize(app);
    app._combatOptionsDefaultSizeModifier = defaultSize;
    const defaultFieldValue = defaultSize === "average" ? "" : defaultSize;
    if (app._combatOptionsSizeOverride && (ctx.fields.sizeModifier ?? "") === defaultFieldValue) {
      app._combatOptionsSizeOverride = false;
    }
    if (!app._combatOptionsSizeOverride) {
      ctx.fields.sizeModifier = defaultFieldValue;
      foundry.utils.setProperty(app.fields ?? (app.fields = {}), "sizeModifier", defaultFieldValue);
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
      foundry.utils.setProperty(app.fields ?? (app.fields = {}), "pinning", false);
    }
    // Remove any lingering listeners before wiring new ones to avoid duplicate handlers
    // when the dialog re-renders the combat options section.
    root.off(".combatOptions");

    // Remember whether the section is expanded so the dialog can restore the state when
    // it is reopened during the same session.
    root.on("toggle.combatOptions", () => {
      app._combatOptionsOpen = root.prop("open");
    });

    // Delegate change events so that dynamically re-rendered controls stay wired without
    // re-attaching listeners to each element individually.
    root.on("change.combatOptions", "[data-co]", (ev) => {
      ev.stopPropagation();
      const el = ev.currentTarget;
      const name = el.name;
      const value = el.type === "checkbox" ? el.checked : el.value;
      const fields = app.fields ?? (app.fields = {});

      foundry.utils.setProperty(fields, name, value);

      if (name === "allOutAttack" && disableAllOutAttack) {
        foundry.utils.setProperty(fields, "allOutAttack", false);
        root.find('input[name="allOutAttack"]').prop("checked", false);
      }

      // Once the player manually selects a size modifier we keep their choice instead of
      // recalculating it automatically from the target token on subsequent renders.
      if (name === "sizeModifier") {
        app._combatOptionsSizeOverride = true;
      }

      // Toggle the visibility of the called shot sub-form so that the dialog only shows
      // the additional inputs when the option is active.
      if (name === "calledShot.enabled") {
        root.find(".combat-options__called-shot").toggleClass("is-hidden", !value);
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
