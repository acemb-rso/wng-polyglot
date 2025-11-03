const modulePathMatch = import.meta.url.replace(/\\/g, "/").match(/^(.*\/modules\/([^/]+))\/scripts\//);
const MODULE_BASE_PATH = modulePathMatch ? modulePathMatch[1] : "";
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
  fullDefence: "Full Defence (+2 Defence until next turn)",
  halfCover: "Half Cover (+1 Defence)",
  fullCover: "Full Cover (+2 Defence)",
};

Hooks.once("init", () => {
  if (MODULE_BASE_PATH) {
    const href = `${MODULE_BASE_PATH}/styles/combat-options.css`;
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }
  }
});

Hooks.once("ready", () => {
  if (game.system.id !== "wrath-and-glory") {
    return;
  }

  Hooks.on("renderWeaponDialog", (app, html) => {
    try {
      ensureWeaponDialogPatched(app);
      injectCombatOptions(app, html);
    }
    catch (err) {
      logError("Failed to render combat options", err);
    }
  });
});

const patchedWeaponDialogPrototypes = new WeakSet();

function ensureWeaponDialogPatched(app) {
  const prototype = app?.constructor?.prototype ?? Object.getPrototypeOf(app);
  if (!prototype || prototype === Application.prototype) {
    return false;
  }

  if (patchedWeaponDialogPrototypes.has(prototype)) {
    return false;
  }

  const originalPrepareContext = prototype._prepareContext;
  const originalDefaultFields = prototype._defaultFields;
  const originalGetSubmission = prototype._getSubmissionData;

  if (typeof originalPrepareContext !== "function" || typeof originalDefaultFields !== "function" || typeof originalGetSubmission !== "function") {
    logError("WeaponDialog prototype missing expected methods");
    return false;
  }

  prototype._prepareContext = async function(options) {
    const context = await originalPrepareContext.call(this, options);
    context.calledShotSizes = {
      tiny: "SIZE.TINY",
      small: "SIZE.SMALL",
      medium: "SIZE.MEDIUM",
    };
    context.coverOptions = {
      "": "No Cover",
      half: COMBAT_OPTION_LABELS.halfCover,
      full: COMBAT_OPTION_LABELS.fullCover,
    };
    const fields = this.fields ?? {};
    context.combatOptionsOpen = Boolean(
      fields.allOutAttack || fields.charging || fields.aim || fields.grapple ||
      fields.fallBack || fields.brace || fields.pinning || fields.fullDefence ||
      fields.cover || fields.calledShot?.enabled
    );
    const weaponTraits = this.weapon?.system?.traits;
    context.hasHeavyTrait = Boolean(typeof weaponTraits?.has === "function" && weaponTraits.has("heavy"));

    try {
      if (this.tooltips && typeof this.computeFields === "function") {
        this.computeFields();
      }
    }
    catch (err) {
      logError("Failed to compute weapon fields", err);
    }
    return context;
  };

  prototype._defaultFields = function() {
    const defaults = originalDefaultFields.call(this) ?? {};
    const calledShotDefaults = {
      enabled: false,
      size: "",
      label: "",
    };

    return foundry.utils.mergeObject({
      distance: null,
      range: null,
      aim: false,
      charging: false,
      allOutAttack: false,
      grapple: false,
      fallBack: false,
      brace: false,
      pinning: false,
      fullDefence: false,
      cover: "",
      calledShot: calledShotDefaults,
    }, defaults, { inplace: false });
  };

  prototype._getSubmissionData = function() {
    const data = originalGetSubmission.call(this);
    if (!data.calledShot?.enabled) {
      if (data.calledShot) {
        data.calledShot.size = "";
        data.calledShot.label = "";
      }
      else {
        data.calledShot = {
          enabled: false,
          size: "",
          label: "",
        };
      }
    }
    return data;
  };

  prototype.computeFields = function() {
    const weapon = this.weapon ?? {};
    const actor = this.actor ?? {};
    this.fields ??= {};

    const baseSnapshot = this._wngCombatExtenderBaseFields;
    if (baseSnapshot) {
      this.fields.pool = Number(baseSnapshot.pool ?? this.fields.pool ?? 0);
      this.fields.damage = Number(baseSnapshot.damage ?? this.fields.damage ?? 0);
      this.fields.difficulty = Number(baseSnapshot.difficulty ?? this.fields.difficulty ?? 0);
      if (!this.fields.ed && baseSnapshot.ed) {
        this.fields.ed = { value: 0, dice: baseSnapshot.ed.dice ?? "" };
      }
      if (!this.fields.ap && baseSnapshot.ap) {
        this.fields.ap = { value: 0, dice: baseSnapshot.ap.dice ?? "" };
      }
      if (this.fields.ed && baseSnapshot.ed) {
        this.fields.ed.value = Number(baseSnapshot.ed.value ?? this.fields.ed.value ?? 0);
        if (baseSnapshot.ed.dice !== undefined) {
          this.fields.ed.dice = baseSnapshot.ed.dice;
        }
      }
      if (this.fields.ap && baseSnapshot.ap) {
        this.fields.ap.value = Number(baseSnapshot.ap.value ?? this.fields.ap.value ?? 0);
      }
    }

    this.fields.calledShot ??= { enabled: false, size: "", label: "" };
    this.fields.pool = Number(this.fields.pool ?? 0);
    this.fields.damage = Number(this.fields.damage ?? 0);
    this.fields.difficulty = Number(this.fields.difficulty ?? 0);
    if (this.fields.ed) {
      this.fields.ed.value = Number(this.fields.ed.value ?? 0);
      this.fields.ed.dice ??= "";
    }
    if (this.fields.ap) {
      this.fields.ap.value = Number(this.fields.ap.value ?? 0);
      this.fields.ap.dice ??= "";
    }

    this._wngCombatExtenderBaseFields = {
      pool: this.fields.pool,
      damage: this.fields.damage,
      difficulty: this.fields.difficulty,
      ed: this.fields.ed ? { value: this.fields.ed.value, dice: this.fields.ed.dice } : undefined,
      ap: this.fields.ap ? { value: this.fields.ap.value, dice: this.fields.ap.dice } : undefined,
    };

    if (this.fields.allOutAttack && this.fields.fullDefence) {
      this.fields.fullDefence = false;
    }

    const tooltips = this.tooltips;
    const hasTooltips = Boolean(tooltips?.start && tooltips?.finish && tooltips?.add);
    const startTooltip = (...args) => {
      if (hasTooltips) {
        tooltips.start(...args);
      }
    };
    const finishTooltip = (...args) => {
      if (hasTooltips) {
        tooltips.finish(...args);
      }
    };
    const addTooltip = (...args) => {
      if (hasTooltips) {
        tooltips.add(...args);
      }
    };

    startTooltip(this);
    this.fields.pool += (weapon.attack?.base || 0) + (weapon.attack?.bonus || 0);
    this.fields.damage += (weapon.system?.damage?.base || 0) + (weapon.system?.damage?.bonus || 0) + ((weapon.system?.damage?.rank || 0) * (actor.system?.advances?.rank || 0));
    if (this.fields.ed) {
      this.fields.ed.value += (weapon.system?.damage?.ed?.base || 0) + (weapon.system?.damage?.ed?.bonus || 0) + ((weapon.system?.damage?.ed?.rank || 0) * (actor.system?.advances?.rank || 0));
    }
    if (this.fields.ap) {
      this.fields.ap.value += (weapon.system?.damage?.ap?.base || 0) + (weapon.system?.damage?.ap?.bonus || 0) + ((weapon.system?.damage?.ap?.rank || 0) * (actor.system?.advances?.rank || 0));
    }

    if (weapon.isMelee) {
      const attribute = weapon.system?.damage?.attribute || "strength";
      const attributeValue = actor.system?.attributes?.[attribute]?.total;
      if (Number.isFinite(attributeValue)) {
        this.fields.damage += attributeValue;
      }
    }
    finishTooltip(this, "Weapon");

    const baseDamage = this.fields.damage;
    const baseEdValue = this.fields.ed?.value;
    const baseEdDice = this.fields.ed?.dice;

    if (this.fields.aim) {
      this.fields.pool++;
      const aimLabel = `${game.i18n.localize("WEAPON.AIM")} (+1 Die or ignore Engaged penalty)`;
      addTooltip("pool", 1, aimLabel);
    }

    if (this.fields.calledShot?.enabled && this.fields.calledShot.size) {
      startTooltip(this);
      let value = 0;
      switch (this.fields.calledShot.size) {
        case "tiny":
          value = 3;
          break;
        case "small":
          value = 2;
          break;
        case "medium":
          value = 1;
          break;
      }
      this.fields.difficulty += value;
      if (this.fields.ed) {
        this.fields.ed.value += value;
      }
      finishTooltip(this, game.i18n.localize("WEAPON.CALLED_SHOT"));
    }
    else if (!this.fields.calledShot?.enabled) {
      this.fields.calledShot.size = "";
    }

    startTooltip(this);
    if (this.fields.range === "short") {
      this.fields.pool += 1;
      finishTooltip(this, "Short Range");
    }
    else if (this.fields.range === "long") {
      this.fields.difficulty += 2;
      finishTooltip(this, "Long Range");
    }
    else {
      finishTooltip();
    }

    if (weapon.isMelee) {
      if (this.fields.charging) {
        this.fields.pool++;
        addTooltip("pool", 1, COMBAT_OPTION_LABELS.charge);
      }

      if (this.fields.allOutAttack) {
        this.fields.pool += 2;
        addTooltip("pool", 2, COMBAT_OPTION_LABELS.allOutAttack);
      }

      if (this.fields.grapple) {
        addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.grapple);
      }

      if (this.fields.fallBack) {
        addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.fallBack);
      }
    }

    if (weapon.isRanged) {
      if (this.fields.brace) {
        const traits = weapon.system?.traits;
        const heavyTrait = typeof traits?.has === "function" ? traits.has("heavy") : undefined;
        const heavyRating = Number(heavyTrait?.rating ?? heavyTrait?.value ?? 0);
        const actorStrength = actor.system?.attributes?.strength?.total;

        if (heavyTrait && Number.isFinite(heavyRating) && heavyRating > 0 && (!Number.isFinite(actorStrength) || actorStrength < heavyRating)) {
          this.fields.difficulty = Math.max(this.fields.difficulty - 2, 0);
          addTooltip("difficulty", -2, COMBAT_OPTION_LABELS.brace);
        }
        else {
          addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.brace);
        }
      }

      if (this.fields.pinning) {
        if (baseDamage) {
          addTooltip("damage", -baseDamage, COMBAT_OPTION_LABELS.pinning);
        }
        this.fields.damage = 0;
        if (this.fields.ed) {
          this.fields.ed.value = 0;
          this.fields.ed.dice = "";
        }
        addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.pinning);
      }
    }

    if (this.fields.fullDefence) {
      addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.fullDefence);
    }

    if (this.fields.cover === "half") {
      addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.halfCover);
    }
    else if (this.fields.cover === "full") {
      addTooltip("difficulty", 0, COMBAT_OPTION_LABELS.fullCover);
    }

    if (this.actor?.isMob) {
      const mobBonus = Math.ceil((this.actor.mob || 0) / 2);
      if (mobBonus > 0) {
        this.fields.pool += mobBonus;
        addTooltip("pool", mobBonus, "Mob");
      }
    }

    if (!this.fields.pinning) {
      this.fields.damage = baseDamage;
      if (this.fields.ed) {
        this.fields.ed.value = baseEdValue;
        this.fields.ed.dice = baseEdDice;
      }
    }
  };

  patchedWeaponDialogPrototypes.add(prototype);
  return true;
}

function injectCombatOptions(app, html) {
  const attackSection = html.find(".attack");
  if (!attackSection.length) {
    return;
  }

  const form = html.closest("form").length ? html.closest("form") : html;
  const hiddenContainer = $('<div class="combat-options__hidden-inputs" style="display:none;"></div>');
  form.append(hiddenContainer);

  const optionInputs = new Map();
  const checkboxControls = new Map();

  const aimGroup = attackSection.find('input[name="aim"]').closest('.form-group');
  if (aimGroup.length) {
    const aimInput = aimGroup.find('input[name="aim"]').detach();
    aimGroup.remove();
    hiddenContainer.append(aimInput);
    optionInputs.set('aim', aimInput);
  }

  const chargingGroup = attackSection.find('input[name="charging"]').closest('.form-group');
  if (chargingGroup.length) {
    const chargingInput = chargingGroup.find('input[name="charging"]').detach();
    chargingGroup.remove();
    hiddenContainer.append(chargingInput);
    optionInputs.set('charging', chargingInput);
  }

  const calledShotGroup = attackSection.find('select[name="calledShot.size"]').closest('.form-group');
  let calledShotSelect;
  let calledShotLabel;
  if (calledShotGroup.length) {
    calledShotSelect = calledShotGroup.find('select[name="calledShot.size"]').detach();
    calledShotLabel = calledShotGroup.find('input[name="calledShot.label"]').detach();
    calledShotGroup.remove();
  }
  else {
    calledShotSelect = $('<select name="calledShot.size"></select>');
    const calledShotSizes = app.context?.calledShotSizes ?? {};
    for (const [value, label] of Object.entries(calledShotSizes)) {
      const option = $('<option></option>').attr('value', value).text(game.i18n.localize(label));
      calledShotSelect.append(option);
    }
    calledShotSelect.prepend('<option value=""></option>');
    calledShotLabel = $('<input type="text" name="calledShot.label" placeholder="Label" />');
  }
  calledShotSelect.val(app.fields.calledShot?.size ?? "");
  calledShotLabel.val(app.fields.calledShot?.label ?? "");

  const calledShotEnabledInput = createHiddenCheckbox('calledShot.enabled', app.fields.calledShot?.enabled ?? false);
  optionInputs.set('calledShot.enabled', calledShotEnabledInput);

  const checkboxNames = [
    'allOutAttack',
    'grapple',
    'fallBack',
    'brace',
    'pinning',
    'fullDefence',
  ];

  for (const name of checkboxNames) {
    const existingValue = Boolean(foundry.utils.getProperty(app.fields, name));
    optionInputs.set(name, createHiddenCheckbox(name, existingValue));
  }

  optionInputs.set('cover', createHiddenText('cover', app.fields.cover ?? ''));

  const details = $('<details class="combat-options"></details>');
  if (app.context?.combatOptionsOpen) {
    details.attr('open', 'open');
  }

  const summary = $(`
    <summary>
      <i class="fas fa-swords combat-options__icon"></i>
      <span>${localizeOrFallback('WNG.CombatOptions', 'Combat Options')}</span>
    </summary>
  `);
  details.append(summary);

  const content = $('<div class="combat-options__content"></div>');
  details.append(content);

  if (app.weapon?.isMelee) {
    const group = $('<div class="combat-options__group"></div>');
    group.append(`<div class="combat-options__header">${localizeOrFallback('WNG.MeleeOptions', 'Melee')}</div>`);
    [
      { name: 'allOutAttack', label: COMBAT_OPTION_LABELS.allOutAttack },
      { name: 'charging', label: COMBAT_OPTION_LABELS.charge },
      { name: 'grapple', label: COMBAT_OPTION_LABELS.grapple },
      { name: 'fallBack', label: COMBAT_OPTION_LABELS.fallBack },
    ].forEach(option => {
      const element = createCheckboxOption(app, option, optionInputs, checkboxControls);
      if (element) {
        group.append(element);
      }
    });
    content.append(group);
  }

  if (app.weapon?.isRanged) {
    const group = $('<div class="combat-options__group"></div>');
    group.append(`<div class="combat-options__header">${localizeOrFallback('WNG.RangedOptions', 'Ranged')}</div>`);
    const hasHeavy = Boolean(app.weapon?.system?.traits?.has?.('heavy'));
    [
      { name: 'aim', label: `${game.i18n.localize('WEAPON.AIM')} (+1 Die or ignore Engaged penalty)` },
      { name: 'brace', label: COMBAT_OPTION_LABELS.brace, disabled: !hasHeavy },
      { name: 'pinning', label: COMBAT_OPTION_LABELS.pinning },
    ].forEach(option => {
      const element = createCheckboxOption(app, option, optionInputs, checkboxControls);
      if (element) {
        group.append(element);
      }
    });
    content.append(group);
  }

  const generalGroup = $('<div class="combat-options__group"></div>');
  generalGroup.append(`<div class="combat-options__header">${localizeOrFallback('WNG.GeneralOptions', 'General')}</div>`);
  const calledShotOption = createCalledShotOption(app, optionInputs, checkboxControls, calledShotSelect, calledShotLabel);
  if (calledShotOption) {
    generalGroup.append(calledShotOption);
  }
  const fullDefenceOption = createCheckboxOption(app, { name: 'fullDefence', label: COMBAT_OPTION_LABELS.fullDefence }, optionInputs, checkboxControls);
  if (fullDefenceOption) {
    generalGroup.append(fullDefenceOption);
  }
  generalGroup.append(createCoverOption(app, optionInputs));
  content.append(generalGroup);

  const insertionPoint = attackSection.find('hr').first();
  if (insertionPoint.length) {
    details.insertBefore(insertionPoint);
  }
  else {
    attackSection.append(details);
  }

  function createHiddenCheckbox(name, initial) {
    const input = $(`<input type="checkbox" name="${name}" class="combat-options__hidden-input" />`);
    input.prop('checked', initial);
    hiddenContainer.append(input);
    return input;
  }

  function createHiddenText(name, value) {
    const input = $(`<input type="hidden" name="${name}" />`);
    input.val(value);
    hiddenContainer.append(input);
    return input;
  }

  function createCheckboxOption(app, option, inputMap, controlMap) {
    const input = inputMap.get(option.name);
    if (!input?.length) {
      return null;
    }

    const wrapper = $('<label class="combat-options__option"></label>');
    const checkbox = $('<input type="checkbox" />');
    checkbox.prop('checked', Boolean(input.prop('checked')));
    if (option.disabled) {
      checkbox.prop('disabled', true);
    }
    const text = $('<span></span>').text(option.label);
    wrapper.append(checkbox, text);

    checkbox.on('change', () => {
      if (checkbox.data('internal')) {
        return;
      }
      const checked = checkbox.prop('checked');
      if (setCheckboxInput(input, checked)) {
        handleConflicts(option.name, checked);
      }
      app.render(false);
    });

    controlMap.set(option.name, {
      update(value) {
        checkbox.data('internal', true);
        checkbox.prop('checked', value);
        checkbox.data('internal', false);
      }
    });

    return wrapper;
  }

  function createCalledShotOption(app, inputMap, controlMap, sizeSelect, labelInput) {
    const hidden = inputMap.get('calledShot.enabled');
    if (!hidden?.length) {
      return null;
    }

    const wrapper = $('<div class="combat-options__option"></div>');
    const checkbox = $('<input type="checkbox" />');
    checkbox.prop('checked', hidden.prop('checked'));
    const label = $('<span></span>').text('Called Shot');
    wrapper.append(checkbox, label);

    const nested = $('<div class="combat-options__nested combat-options__called-shot"></div>');
    const sizeRow = $('<label class="combat-options__note"></label>').text('Size');
    sizeSelect.addClass('combat-options__select');
    sizeRow.append(sizeSelect);
    nested.append(sizeRow);
    const textRow = $('<label class="combat-options__note"></label>').text('Label');
    textRow.append(labelInput);
    nested.append(textRow);
    wrapper.append(nested);

    const toggle = (active) => {
      nested.toggle(active);
      sizeSelect.prop('disabled', !active);
      labelInput.prop('disabled', !active);
    };

    checkbox.on('change', () => {
      const checked = checkbox.prop('checked');
      if (setCheckboxInput(hidden, checked)) {
        toggle(checked);
      }
      else {
        toggle(checked);
      }
      app.render(false);
    });

    controlMap.set('calledShot.enabled', {
      update(value) {
        checkbox.data('internal', true);
        checkbox.prop('checked', value);
        checkbox.data('internal', false);
        toggle(value);
      }
    });

    toggle(hidden.prop('checked'));
    return wrapper;
  }

  function createCoverOption(app, inputMap) {
    const input = inputMap.get('cover');
    const wrapper = $('<label class="combat-options__option combat-options__option--select"></label>');
    const span = $('<span></span>').text('Cover');
    const select = $('<select></select>');
    [
      { value: '', label: 'No Cover' },
      { value: 'half', label: COMBAT_OPTION_LABELS.halfCover },
      { value: 'full', label: COMBAT_OPTION_LABELS.fullCover },
    ].forEach(option => {
      select.append($('<option></option>').attr('value', option.value).text(option.label));
    });
    select.val(input?.val() ?? '');
    select.on('change', () => {
      input.val(select.val()).trigger('change');
      app.render(false);
    });
    wrapper.append(span, select);
    return wrapper;
  }

  function setCheckboxInput(input, value) {
    if (!input?.length || Boolean(input.prop('checked')) === Boolean(value)) {
      return false;
    }
    input.prop('checked', Boolean(value)).trigger('change');
    return true;
  }

  function handleConflicts(name, checked) {
    if (!checked) {
      return;
    }
    if (name === 'allOutAttack') {
      syncOption('fullDefence', false);
    }
    else if (name === 'fullDefence') {
      syncOption('allOutAttack', false);
    }
  }

  function syncOption(name, value) {
    const input = optionInputs.get(name);
    if (!input?.length) {
      return;
    }
    const changed = setCheckboxInput(input, value);
    const control = checkboxControls.get(name);
    if (control) {
      control.update(Boolean(input.prop('checked')));
    }
    if (changed) {
      app.render(false);
    }
  }

  function localizeOrFallback(key, fallback) {
    try {
      if (game.i18n?.has?.(key)) {
        return game.i18n.localize(key);
      }
      const localized = game.i18n.localize(key);
      return localized !== key ? localized : fallback;
    }
    catch {
      return fallback;
    }
  }
}
