// modules/wng-CombatExtender/scripts/combat-options.js

const MODULE_ID = "wng-CombatExtender";
const MODULE_BASE_PATH = `modules/${MODULE_ID}`;
const TEMPLATE_BASE_PATH = `${MODULE_BASE_PATH}/templates`;
const MODULE_LABEL = "WNG Combat Extender";

const log = (level, message, ...data) => {
  const logger = console[level] ?? console.log;
  logger(`${MODULE_LABEL} | ${message}`, ...data);
};
const logError = (...args) => log("error", ...args);

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

const VISION_PENALTIES = {
  twilight: { label: "Vision: Twilight, Light Shadows, Heavy Mist (+1 DN Ranged / +0 DN Melee)", ranged: 1, melee: 0 },
  dim: {      label: "Vision: Very Dim Light, Heavy Rain, Fog, Drifting Smoke (+2 DN Ranged / +1 DN Melee)", ranged: 2, melee: 1 },
  heavy: {    label: "Vision: Heavy Fog, Deployed Smoke, Torrential Storm (+3 DN Ranged / +2 DN Melee)", ranged: 3, melee: 2 },
  darkness: { label: "Vision: Total Darkness, Thermal Smoke (+4 DN Ranged / +3 DN Melee)", ranged: 4, melee: 3 }
};

const SIZE_MODIFIER_OPTIONS = {
  tiny:        { label: "Tiny Target (+2 DN)", difficulty: 2 },
  small:       { label: "Small Target (+1 DN)", difficulty: 1 },
  average:     { label: "Average Target (No modifier)" },
  large:       { label: "Large Target (+1 Die)", pool: 1 },
  huge:        { label: "Huge Target (+2 Dice)", pool: 2 },
  gargantuan:  { label: "Gargantuan Target (+3 Dice)", pool: 3 }
};

const SIZE_OPTION_KEYS = new Set(Object.keys(SIZE_MODIFIER_OPTIONS));

function normalizeSizeKey(size) {
  if (!size) return "average";
  const key = String(size).trim().toLowerCase();
  if (!key) return "average";
  return SIZE_OPTION_KEYS.has(key) ? key : "average";
}

function getTargetSize(dialog) {
  const target = dialog?.data?.targets?.[0];
  const actor = target?.actor ?? target?.document?.actor;
  if (!actor) return "average";

  const size = actor.system?.combat?.size ?? actor.system?.size ?? actor.size;
  return normalizeSizeKey(size);
}

Hooks.once("init", async () => {
  await loadTemplates([
    `${TEMPLATE_BASE_PATH}/combat-options.hbs`,
    `${TEMPLATE_BASE_PATH}/partials/co-checkbox.hbs`,
    `${TEMPLATE_BASE_PATH}/partials/co-select.hbs`
  ]);

  Handlebars.registerPartial("co-checkbox", await fetch(`${TEMPLATE_BASE_PATH}/partials/co-checkbox.hbs`).then(r => r.text()));
  Handlebars.registerPartial("co-select", await fetch(`${TEMPLATE_BASE_PATH}/partials/co-select.hbs`).then(r => r.text()));

  Handlebars.registerHelper("t", (s) => String(s));
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("not", (v) => !v);
  Handlebars.registerHelper("concat", (...a) => a.slice(0, -1).join(""));
});

const patchedWeaponDialogPrototypes = new WeakSet();

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

    const addTooltip = (...args) => tooltips?.add?.(...args);

    const salvoValue = Number(weapon?.system?.salvo ?? weapon?.salvo ?? 0);
    const canPinning = Boolean(weapon?.isRanged) && Number.isFinite(salvoValue) && salvoValue > 1;
    if (!canPinning && fields.pinning) {
      fields.pinning = false;
    }

    const baseSnapshot = {
      pool: Number(fields.pool ?? 0),
      difficulty: Number(fields.difficulty ?? 0),
      damage: fields.damage,
      ed: foundry.utils.deepClone(fields.ed ?? { value: 0, dice: "" })
    };

    const defaultSize = getTargetSize(this);
    this._combatOptionsDefaultSizeModifier = defaultSize;

    const defaultFieldValue = defaultSize === "average" ? "" : defaultSize;
    if (this._combatOptionsSizeOverride && (fields.sizeModifier ?? "") === defaultFieldValue) {
      this._combatOptionsSizeOverride = false;
    }

    if (!this._combatOptionsSizeOverride) {
      fields.sizeModifier = defaultFieldValue;
    }

    const baseSizeModifier = SIZE_MODIFIER_OPTIONS[defaultSize];
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

    if (weapon?.isMelee) {
      if (fields.allOutAttack) {
        fields.pool += 2;
        addTooltip("pool", 2, COMBAT_OPTION_LABELS.allOutAttack);
      }
      if (fields.grapple)  addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.grapple);
      if (fields.fallBack) addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.fallBack);
    }

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

Hooks.on("renderWeaponDialog", async (app, html) => {
  try {
    if (game.system.id !== "wrath-and-glory") return;

    ensureWeaponDialogPatched(app);

    const $html = html instanceof jQuery ? html : $(html);

    // Remove original controls to prevent duplicates
    $html.find('.form-group').has('input[name="aim"]').remove();
    $html.find('.form-group').has('input[name="charging"]').remove();
    $html.find('.form-group').has('select[name="calledShot.size"]').remove();

    const attackSection = $html.find(".attack");
    if (!attackSection.length) return;

    // Store the initial computed values so we can reset to them
    if (!app._initialFieldsComputed) {
      if (typeof app.computeInitialFields === 'function') {
        app.computeInitialFields();
      }
      app._initialFieldsComputed = true;
    }

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
        allOutAttack: "All-Out Attack (+2 Dice / –2 Defence)",
        charge: "Charge (+1 Die, 2× Speed)",
        grapple: "Grapple (Opposed Strength Test)",
        fallBack: "Fall Back (Disengage safely)",
        brace: "Brace (Negate Heavy trait)",
        pinning: "Suppressing Fire (Pinning)",
        cover: "Cover",
        vision: "Vision",
        size: "Target Size",
        calledShot: "Called Shot",
        calledShotSize: "Target Size",
        disarm: "Disarm (No damage)"
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
    root.off(".combatOptions");

    root.on("toggle.combatOptions", () => {
      app._combatOptionsOpen = root.prop("open");
    });

    root.on("change.combatOptions", "[data-co]", (ev) => {
      ev.stopPropagation();
      const el = ev.currentTarget;
      const name = el.name;
      const value = el.type === "checkbox" ? el.checked : el.value;
      const fields = app.fields ?? (app.fields = {});

      foundry.utils.setProperty(fields, name, value);

      if (name === "sizeModifier") {
        app._combatOptionsSizeOverride = true;
      }

      if (name === "calledShot.enabled") {
        root.find(".combat-options__called-shot").toggleClass("is-hidden", !value);
      }

      // Force complete recalculation
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
