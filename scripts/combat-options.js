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
  const originalComputeFields = prototype.computeFields;

  if (typeof originalPrepareContext !== "function" || typeof originalDefaultFields !== "function" || typeof originalComputeFields !== "function") {
    logError("WeaponDialog prototype missing expected methods");
    return false;
  }

  // Patch _prepareContext to add our custom context
  prototype._prepareContext = async function(options) {
    const context = await originalPrepareContext.call(this, options);
    
    // Add cover options to context
    context.coverOptions = {
      "": "No Cover",
      half: COMBAT_OPTION_LABELS.halfCover,
      full: COMBAT_OPTION_LABELS.fullCover,
    };
    
    // Determine if combat options should be open
    const fields = this.fields ?? {};
    context.combatOptionsOpen = Boolean(
      fields.allOutAttack || fields.charging || fields.aim || fields.grapple ||
      fields.fallBack || fields.brace || fields.pinning || fields.fullDefence ||
      fields.cover || fields.calledShot?.size
    );
    
    context.hasHeavyTrait = Boolean(this.weapon?.system?.traits?.has("heavy"));
    
    return context;
  };

  // Patch _defaultFields to add our new fields
  prototype._defaultFields = function() {
    const defaults = originalDefaultFields.call(this) ?? {};
    
    // Add our new combat option fields
    return foundry.utils.mergeObject(defaults, {
      charging: false,
      allOutAttack: false,
      grapple: false,
      fallBack: false,
      brace: false,
      pinning: false,
      fullDefence: false,
      cover: "",
    }, { inplace: false });
  };

  // Extend computeFields to add our combat option logic
  prototype.computeFields = function() {
    // Call original computeFields first
    originalComputeFields.call(this);
    
    const weapon = this.weapon;
    
    // Handle conflicts between options
    if (this.fields.allOutAttack && this.fields.fullDefence) {
      this.fields.fullDefence = false;
    }
    
    // Store base damage values for pinning attack
    const baseDamage = this.fields.damage;
    const baseEdValue = this.fields.ed.value;
    const baseEdDice = this.fields.ed.dice;

    // Melee-specific options
    if (weapon.isMelee) {
      if (this.fields.allOutAttack) {
        this.fields.pool += 2;
        this.tooltips.add("pool", 2, COMBAT_OPTION_LABELS.allOutAttack);
      }

      if (this.fields.grapple) {
        this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.grapple);
      }

      if (this.fields.fallBack) {
        this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.fallBack);
      }
    }

    // Ranged-specific options
    if (weapon.isRanged) {
      if (this.fields.brace) {
        const heavyTrait = weapon.system.traits.has("heavy");
        const heavyRating = Number(heavyTrait?.rating ?? heavyTrait?.value ?? 0);
        const actorStrength = this.actor.system.attributes.strength.total;

        if (heavyTrait && Number.isFinite(heavyRating) && heavyRating > 0 && actorStrength < heavyRating) {
          this.fields.difficulty = Math.max(this.fields.difficulty - 2, 0);
          this.tooltips.add("difficulty", -2, COMBAT_OPTION_LABELS.brace);
        }
        else {
          this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.brace);
        }
      }

      if (this.fields.pinning) {
        if (baseDamage) {
          this.tooltips.add("damage", -baseDamage, COMBAT_OPTION_LABELS.pinning);
        }
        this.fields.damage = 0;
        this.fields.ed.value = 0;
        this.fields.ed.dice = "";
        this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.pinning);
      }
    }

    // General options
    if (this.fields.fullDefence) {
      this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.fullDefence);
    }

    if (this.fields.cover === "half") {
      this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.halfCover);
    }
    else if (this.fields.cover === "full") {
      this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.fullCover);
    }

    // Restore damage values if not pinning
    if (!this.fields.pinning) {
      this.fields.damage = baseDamage;
      this.fields.ed.value = baseEdValue;
      this.fields.ed.dice = baseEdDice;
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

  // Move aim checkbox to hidden container
  const aimGroup = attackSection.find('input[name="aim"]').closest('.form-group');
  if (aimGroup.length) {
    const aimInput = aimGroup.find('input[name="aim"]').detach();
    aimGroup.remove();
    hiddenContainer.append(aimInput);
    optionInputs.set('aim', aimInput);
  }

  // Move charging checkbox to hidden container (if it exists)
  const chargingGroup = attackSection.find('input[name="charging"]').closest('.form-group');
  if (chargingGroup.length) {
    const chargingInput = chargingGroup.find('input[name="charging"]').detach();
    chargingGroup.remove();
    hiddenContainer.append(chargingInput);
    optionInputs.set('charging', chargingInput);
  }

  // Handle called shot - enhance existing or create new
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
    const calledShotSizes = app.context?.calledShotSizes ?? {
      tiny: "SIZE.TINY",
      small: "SIZE.SMALL",
      medium: "SIZE.MEDIUM",
    };
    for (const [value, label] of Object.entries(calledShotSizes)) {
      const option = $('<option></option>').attr('value', value).text(game.i18n.localize(label));
      calledShotSelect.append(option);
    }
    calledShotSelect.prepend('<option value=""></option>');
    calledShotLabel = $('<input type="text" name="calledShot.label" placeholder="Label" />');
  }
  
  calledShotSelect.val(app.fields.calledShot?.size ?? "");
  calledShotLabel.val(app.fields.calledShot?.label ?? "");

  // Create hidden inputs for our new options
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

  // Create the combat options details element
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

  // Melee options
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

  // Ranged options
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

  // General options
  const generalGroup = $('<div class="combat-options__group"></div>');
  generalGroup.append(`<div class="combat-options__header">${localizeOrFallback('WNG.GeneralOptions', 'General')}</div>`);
  
  const calledShotOption = createCalledShotOption(app, calledShotSelect, calledShotLabel);
  if (calledShotOption) {
    generalGroup.append(calledShotOption);
  }
  
  const fullDefenceOption = createCheckboxOption(app, { name: 'fullDefence', label: COMBAT_OPTION_LABELS.fullDefence }, optionInputs, checkboxControls);
  if (fullDefenceOption) {
    generalGroup.append(fullDefenceOption);
  }
  
  generalGroup.append(createCoverOption(app, optionInputs));
  content.append(generalGroup);

  // Insert the combat options into the dialog
  const insertionPoint = attackSection.find('hr').first();
  if (insertionPoint.length) {
    details.insertBefore(insertionPoint);
  }
  else {
    attackSection.append(details);
  }

  // Helper function to create hidden checkbox
  function createHiddenCheckbox(name, initial) {
    const input = $(`<input type="checkbox" name="${name}" class="combat-options__hidden-input" />`);
    input.prop('checked', initial);
    hiddenContainer.append(input);
    return input;
  }

  // Helper function to create hidden text input
  function createHiddenText(name, value) {
    const input = $(`<input type="hidden" name="${name}" />`);
    input.val(value);
    hiddenContainer.append(input);
    return input;
  }

  // Helper function to create checkbox option
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

  // Helper function to create called shot option
  function createCalledShotOption(app, sizeSelect, labelInput) {
    const wrapper = $('<div class="combat-options__option"></div>');
    const checkbox = $('<input type="checkbox" />');
    checkbox.prop('checked', Boolean(app.fields.calledShot?.size));
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
      if (!active) {
        sizeSelect.val('');
        labelInput.val('');
      }
    };

    checkbox.on('change', () => {
      const checked = checkbox.prop('checked');
      toggle(checked);
      app.render(false);
    });

    sizeSelect.on('change', () => {
      app.render(false);
    });

    labelInput.on('change', () => {
      app.render(false);
    });

    toggle(Boolean(app.fields.calledShot?.size));
    return wrapper;
  }

  // Helper function to create cover option
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

  // Helper function to set checkbox input value
  function setCheckboxInput(input, value) {
    if (!input?.length || Boolean(input.prop('checked')) === Boolean(value)) {
      return false;
    }
    input.prop('checked', Boolean(value)).trigger('change');
    return true;
  }

  // Helper function to handle conflicts between options
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

  // Helper function to sync option values
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

  // Helper function for localization with fallback
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
