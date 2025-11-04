// modules/wng-CombatExtender/scripts/combat-options.js

// --- Module path & labels ----------------------------------------------------
const MODULE_ID = "wng-CombatExtender";
const MODULE_BASE_PATH = `modules/${MODULE_ID}`;
const TEMPLATE_BASE_PATH = `${MODULE_BASE_PATH}/templates`;
const MODULE_LABEL = "WNG Combat Extender";

// --- Logging -----------------------------------------------------------------
const log = (level, message, ...data) => {
  const logger = console[level] ?? console.log;
  logger(`${MODULE_LABEL} | ${message}`, ...data);
};
const logError = (...args) => log("error", ...args);

// --- Labels / Tables ---------------------------------------------------------
const COMBAT_OPTION_LABELS = {
  allOutAttack: "All-Out Attack (+2 Dice / –2 Defence)",
  charge: "Charge (+1 Die, 2× Speed)",
  grapple: "Grapple (Opposed Strength Test)",
  fallBack: "Fall Back (Withdraw safely)",
  brace: "Brace (Negate Heavy trait)",
  pinning: "Pinning Attack (No damage, target tests Resolve)",
  fullDefence: "Full Defence (+2 Defence until next turn)",
  halfCover: "Half Cover (+1 Defence)",
  fullCover: "Full Cover (+2 Defence)",
  pistolsInMelee: "Pistols In Melee (+2 DN to Ballistic Skill)",
  calledShotDisarm: "Shot To Disarm (No damage)"
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

// --- Template preloading & helpers ------------------------------------------
Hooks.once("init", async () => {
  await loadTemplates([
    `${TEMPLATE_BASE_PATH}/combat-options.hbs`,
    `${TEMPLATE_BASE_PATH}/partials/co-checkbox.hbs`,
    `${TEMPLATE_BASE_PATH}/partials/co-select.hbs`
  ]);

  Handlebars.registerHelper("t", (s) => String(s));          // passthrough
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("not", (v) => !v);
  Handlebars.registerHelper("concat", (...a) => a.slice(0, -1).join(""));
});

// --- Patch WeaponDialog prototype (context/defaults/compute) ----------------
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

  // Add UI context
  prototype._prepareContext = async function (options) {
    const context = await originalPrepareContext.call(this, options);

    context.coverOptions = {
      "": "No Cover",
      half: COMBAT_OPTION_LABELS.halfCover,
      full: COMBAT_OPTION_LABELS.fullCover
    };

    const fields = this.fields ?? {};
    context.combatOptionsOpen = Boolean(
      fields.allOutAttack || fields.charging || fields.aim || fields.grapple ||
      fields.fallBack || fields.brace || fields.pinning || fields.fullDefence ||
      fields.cover || fields.pistolsInMelee || fields.sizeModifier || fields.visionPenalty ||
      fields.calledShot?.enabled || fields.calledShot?.size || fields.calledShot?.disarm
    );

    context.hasHeavyTrait = Boolean(this.weapon?.system?.traits?.has?.("heavy"));
    return context;
  };

  // Add default fields
  prototype._defaultFields = function () {
    const defaults = originalDefaultFields.call(this) ?? {};
    return foundry.utils.mergeObject(defaults, {
      charging: false,
      allOutAttack: false,
      grapple: false,
      fallBack: false,
      brace: false,
      pinning: false,
      fullDefence: false,
      cover: "",
      pistolsInMelee: false,
      sizeModifier: "",
      visionPenalty: "",
      calledShot: {
        enabled: false,
        disarm: false,
        size: "",
        label: "",
        entangle: false
      }
    }, { inplace: false });
  };

  // Apply modifiers/tooltips
  prototype.computeFields = function () {
    originalComputeFields.call(this);

    const weapon = this.weapon;

    // Mutual exclusivity: AOA vs Full Defence
    if (this.fields.allOutAttack && this.fields.fullDefence) {
      this.fields.fullDefence = false;
    }

    const baseDamage  = this.fields.damage;
    const baseEdValue = this.fields.ed.value;
    const baseEdDice  = this.fields.ed.dice;
    let damageSuppressed = false;

    // Melee
    if (weapon.isMelee) {
      if (this.fields.allOutAttack) {
        this.fields.pool += 2;
        this.tooltips.add("pool", 2, COMBAT_OPTION_LABELS.allOutAttack);
      }
      if (this.fields.grapple)  this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.grapple);
      if (this.fields.fallBack) this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.fallBack);
    }

    // Ranged
    if (weapon.isRanged) {
      if (this.fields.brace) {
        const heavyTrait = weapon.system?.traits?.get?.("heavy") ?? weapon.system?.traits?.has?.("heavy");
        // Try to read a rating (system variants differ)
        const heavyRating = Number(heavyTrait?.rating ?? heavyTrait?.value ?? 0);
        const actorStrength = this.actor.system?.attributes?.strength?.total ?? 0;

        if (heavyTrait && Number.isFinite(heavyRating) && heavyRating > 0 && actorStrength < heavyRating) {
          this.fields.difficulty = Math.max(this.fields.difficulty - 2, 0);
          this.tooltips.add("difficulty", -2, COMBAT_OPTION_LABELS.brace);
        } else {
          this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.brace);
        }
      }

      if (this.fields.pinning) {
        if (baseDamage) this.tooltips.add("damage", -baseDamage, COMBAT_OPTION_LABELS.pinning);
        this.fields.damage = 0;
        this.fields.ed.value = 0;
        this.fields.ed.dice = "";
        this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.pinning);
        damageSuppressed = true;
      }

      if (this.fields.pistolsInMelee && weapon.system?.traits?.has?.("pistol")) {
        this.fields.difficulty += 2;
        this.tooltips.add("difficulty", 2, COMBAT_OPTION_LABELS.pistolsInMelee);
      }
    }

    if (this.fields.fullDefence) {
      this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.fullDefence);
    }

    // Vision
    const visionKey = this.fields.visionPenalty;
    const visionPenalty = VISION_PENALTIES[visionKey];
    if (visionPenalty) {
      const penalty = weapon.isMelee ? visionPenalty.melee : visionPenalty.ranged;
      if (penalty > 0) this.fields.difficulty += penalty;
      this.tooltips.add("difficulty", penalty ?? 0, visionPenalty.label);
    }

    // Size
    const sizeKey = this.fields.sizeModifier;
    const sizeModifier = SIZE_MODIFIER_OPTIONS[sizeKey];
    if (sizeModifier) {
      if (sizeModifier.pool) {
        this.fields.pool += sizeModifier.pool;
        this.tooltips.add("pool", sizeModifier.pool, sizeModifier.label);
      }
      if (sizeModifier.difficulty) {
        this.fields.difficulty += sizeModifier.difficulty;
        this.tooltips.add("difficulty", sizeModifier.difficulty, sizeModifier.label);
      }
    }

    // Called shot: Disarm
    if (this.fields.calledShot?.disarm) {
      if (baseDamage) this.tooltips.add("damage", -baseDamage, COMBAT_OPTION_LABELS.calledShotDisarm);
      this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.calledShotDisarm);
      this.fields.damage = 0;
      this.fields.ed.value = 0;
      this.fields.ed.dice = "";
      damageSuppressed = true;
    }

    // Cover (tooltip only; W&G system applies the real math)
    if (this.fields.cover === "half") this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.halfCover);
    else if (this.fields.cover === "full") this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.fullCover);

    if (!damageSuppressed) {
      this.fields.damage  = baseDamage;
      this.fields.ed.value = baseEdValue;
      this.fields.ed.dice  = baseEdDice;
    }
  };

  patchedWeaponDialogPrototypes.add(prototype);
  return true;
}

// --- Single render hook (template-based UI, delegated listeners) -------------
Hooks.on("renderWeaponDialog", async (app, html) => {
  try {
    if (game.system.id !== "wrath-and-glory") return;

    // Make sure prototype extensions are in place
    ensureWeaponDialogPatched(app);

    const $html = html instanceof jQuery ? html : $(html);

    // Anchor
    const attackSection = $html.find(".attack");
    if (!attackSection.length) return;

    // Template context
    const ctx = {
      open: app._combatOptionsOpen ?? false,
      isMelee: !!app.weapon?.isMelee,
      isRanged: !!app.weapon?.isRanged,
      hasHeavy: !!app.weapon?.system?.traits?.has?.("heavy"),
      fields: foundry.utils.duplicate(app.fields ?? {}),
      labels: {
        allOutAttack: "All-Out Attack (+2 Dice / –2 Defence)",
        fullDefence: "Full Defence (+2 Defence / –2 Dice)",
        charge: "Charge (+1 Die, 2× Speed)",
        grapple: "Grapple (Opposed Strength Test)",
        fallBack: "Fall Back (Disengage safely)",
        brace: "Brace (ignore Heavy penalty with STR)",
        pinning: "Suppressing Fire (Pinning)",
        cover: "Cover",
        vision: "Vision",
        size: "Target Size",
        calledShot: "Called Shot",
        calledShotSize: "Target Size",
        calledShotLabel: "Label",
        disarm: "Disarm (0 Damage)",
        entangle: "Entangle"
      },
      coverOptions: [
        { value: "",     label: "No Cover" },
        { value: "half", label: "Half Cover (+1 DN)" },
        { value: "full", label: "Full Cover (+2 DN)" }
      ],
      visionOptions: [
        { value: "",        label: "Normal" },
        { value: "lowLight",label: "Low Light (+1 DN)" },
        { value: "darkness",label: "Darkness (+2 DN)" }
      ],
      sizeOptions: [
        { value: "",           label: "Average Target (No modifier)" },
        { value: "small",      label: "Small Target (–1 Die, +1 DN)" },
        { value: "large",      label: "Large Target (+1 Die)" },
        { value: "huge",       label: "Huge Target (+2 Dice)" },
        { value: "gargantuan", label: "Gargantuan Target (+3 Dice)" }
      ],
      calledShotSizes: [
        { value: "tiny",   label: game.i18n.localize("SIZE.TINY") },
        { value: "small",  label: game.i18n.localize("SIZE.SMALL") },
        { value: "medium", label: game.i18n.localize("SIZE.MEDIUM") }
      ]
    };

    // Render & inject (idempotent)
    const existing = attackSection.find("[data-co-root]");
    const htmlFrag = await renderTemplate(`${TEMPLATE_BASE_PATH}/combat-options.hbs`, ctx);
    if (existing.length) existing.replaceWith(htmlFrag);
    else attackSection.append(htmlFrag);

    // Delegated listeners
    const root = attackSection.find("[data-co-root]");
    root.off(".combatOptions");

    // Track collapse state
    root.on("toggle.combatOptions", () => {
      app._combatOptionsOpen = root.prop("open");
    });

    // Generic input handler
    root.on("change.combatOptions input.combatOptions", "[data-co]", (ev) => {
      const el = ev.currentTarget;
      const name = el.name;
      const value = el.type === "checkbox" ? el.checked : el.value;
      foundry.utils.setProperty(app.fields, name, value);

      // Inter-option conflicts
      if (name === "allOutAttack" && value) foundry.utils.setProperty(app.fields, "fullDefence", false);
      if (name === "fullDefence"  && value) foundry.utils.setProperty(app.fields, "allOutAttack", false);

      // Show/hide called shot panel
      if (name === "calledShot.enabled") {
        root.find(".combat-options__called-shot").toggleClass("is-hidden", !value);
      }

      if (typeof app.submit === "function") app.submit({ preventClose: true });
    });

  } catch (err) {
    logError("Failed to render combat options", err);
  }
});
