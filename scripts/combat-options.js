const modulePathMatch = import.meta.url.replace(/\\/g, "/").match(/^(.*\/modules\/([^/]+))\/scripts\//);
const MODULE_BASE_PATH = modulePathMatch ? modulePathMatch[1] : "";
const MODULE_LABEL = "WNG Combat Extender";

const log = (level, message, ...data) => {
  const logger = console[level] ?? console.log;
  logger(`${MODULE_LABEL} | ${message}`, ...data);
};

const logError = (...args) => log("error", ...args);
const logWarn = (...args) => log("warn", ...args);

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

  Hooks.on("renderWeaponDialog", (app, html, data) => {
    try {
      ensureWeaponDialogPatched(app);
      const normalizedHtml = toJQuery(html, "renderWeaponDialog");
      if (!normalizedHtml?.length) {
        logError("renderWeaponDialog received invalid html parameter", html);
        return;
      }
      injectCombatOptions(app, normalizedHtml, data);
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
    
    context.coverOptions = {
      "": "No Cover",
      half: COMBAT_OPTION_LABELS.halfCover,
      full: COMBAT_OPTION_LABELS.fullCover,
    };
    
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
    originalComputeFields.call(this);
    
    const weapon = this.weapon;
    
    if (this.fields.allOutAttack && this.fields.fullDefence) {
      this.fields.fullDefence = false;
    }
    
    const baseDamage = this.fields.damage;
    const baseEdValue = this.fields.ed.value;
    const baseEdDice = this.fields.ed.dice;

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

    if (this.fields.fullDefence) {
      this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.fullDefence);
    }

    if (this.fields.cover === "half") {
      this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.halfCover);
    }
    else if (this.fields.cover === "full") {
      this.tooltips.add("difficulty", 0, COMBAT_OPTION_LABELS.fullCover);
    }

    if (!this.fields.pinning) {
      this.fields.damage = baseDamage;
      this.fields.ed.value = baseEdValue;
      this.fields.ed.dice = baseEdDice;
    }
  };

  patchedWeaponDialogPrototypes.add(prototype);
  return true;
}

function toJQuery(html, hookName) {
  if (html instanceof jQuery || html?.jquery) {
    return html;
  }
  if (html instanceof HTMLElement) {
    return $(html);
  }
  if (Array.isArray(html)) {
    const elements = html.filter((element) => element instanceof HTMLElement);
    if (elements.length) {
      return $(elements);
    }
  }
  logError(`${hookName} received unsupported html parameter`, html);
  return null;
}

function injectCombatOptions(app, html) {
  if (!app || !html || typeof html.find !== "function") {
    logError("injectCombatOptions called with invalid arguments");
    return;
  }

  const attackSection = html.find(".attack");
  if (!attackSection.length) {
    return;
  }

  const form = html.closest("form").length ? html.closest("form") : html;

  // Store references to actual form inputs
  const formInputs = new Map();
  const checkboxControls = new Map();

  // Find or create actual form inputs (not hidden display inputs)
  const findOrCreateInput = (name, type = 'checkbox', defaultValue = false) => {
    let input = attackSection.find(`input[name="${name}"]`);
    
    if (!input.length) {
      // Create the input if it doesn't exist
      if (type === 'checkbox') {
        input = $(`<input type="checkbox" name="${name}" />`);
        input.prop('checked', defaultValue);
      } else {
        input = $(`<input type="hidden" name="${name}" />`);
        input.val(defaultValue);
      }
      form.append(input);
    }
    
    return input;
  };

  // Move aim input to our control (if it exists)
  const aimGroup = attackSection.find('input[name="aim"]').closest('.form-group');
  let aimInput;
  if (aimGroup.length) {
    aimInput = aimGroup.find('input[name="aim"]');
    aimGroup.remove();
  } else {
    aimInput = findOrCreateInput('aim', 'checkbox', app.fields?.aim ?? false);
  }
  formInputs.set('aim', aimInput);

  // Move charging input (if it exists)
  const chargingGroup = attackSection.find('input[name="charging"]').closest('.form-group');
  let chargingInput;
  if (chargingGroup.length) {
    chargingInput = chargingGroup.find('input[name="charging"]');
    chargingGroup.remove();
  } else {
    chargingInput = findOrCreateInput('charging', 'checkbox', app.fields?.charging ?? false);
  }
  formInputs.set('charging', chargingInput);

  // Handle called shot
  const calledShotGroup = attackSection.find('select[name="calledShot.size"]').closest('.form-group');
  let calledShotSelect, calledShotLabel;
  
  if (calledShotGroup.length) {
    calledShotSelect = calledShotGroup.find('select[name="calledShot.size"]');
    calledShotLabel = calledShotGroup.find('input[name="calledShot.label"]');
    calledShotGroup.remove();
  } else {
    calledShotSelect = $('<select name="calledShot.size"></select>');
    calledShotSelect.append('<option value=""></option>');
    const sizes = { tiny: "SIZE.TINY", small: "SIZE.SMALL", medium: "SIZE.MEDIUM" };
    for (const [value, label] of Object.entries(sizes)) {
      calledShotSelect.append($('<option></option>').attr('value', value).text(game.i18n.localize(label)));
    }
    calledShotLabel = $('<input type="text" name="calledShot.label" placeholder="Label" />');
    form.append(calledShotSelect, calledShotLabel);
  }
  
  calledShotSelect.val(app.fields.calledShot?.size ?? "");
  calledShotLabel.val(app.fields.calledShot?.label ?? "");

  // Create inputs for new options
  ['allOutAttack', 'grapple', 'fallBack', 'brace', 'pinning', 'fullDefence'].forEach(name => {
    formInputs.set(name, findOrCreateInput(name, 'checkbox', app.fields?.[name] ?? false));
  });
  
  formInputs.set('cover', findOrCreateInput('cover', 'text', app.fields?.cover ?? ''));

  // Create the UI
  const details = $('<details class="combat-options"></details>');
  if (app.context?.combatOptionsOpen) {
    details.attr('open', 'open');
  }

  details.append($(`
    <summary>
      <i class="fas fa-swords combat-options__icon"></i>
      <span>${localizeOrFallback('WNG.CombatOptions', 'Combat Options')}</span>
    </summary>
  `));

  const content = $('<div class="combat-options__content"></div>');
  details.append(content);

  // Add melee options
  if (app.weapon?.isMelee) {
    const group = $('<div class="combat-options__group"></div>');
    group.append(`<div class="combat-options__header">${localizeOrFallback('WNG.MeleeOptions', 'Melee')}</div>`);
    [
      { name: 'allOutAttack', label: COMBAT_OPTION_LABELS.allOutAttack },
      { name: 'charging', label: COMBAT_OPTION_LABELS.charge },
      { name: 'grapple', label: COMBAT_OPTION_LABELS.grapple },
      { name: 'fallBack', label: COMBAT_OPTION_LABELS.fallBack },
    ].forEach(opt => {
      const el = createCheckboxOption(app, opt, formInputs, checkboxControls);
      if (el) group.append(el);
    });
    content.append(group);
  }

  // Add ranged options
  if (app.weapon?.isRanged) {
    const group = $('<div class="combat-options__group"></div>');
    group.append(`<div class="combat-options__header">${localizeOrFallback('WNG.RangedOptions', 'Ranged')}</div>`);
    const hasHeavy = Boolean(app.weapon?.system?.traits?.has?.('heavy'));
    [
      { name: 'aim', label: `${game.i18n.localize('WEAPON.AIM')} (+1 Die or ignore Engaged penalty)` },
      { name: 'brace', label: COMBAT_OPTION_LABELS.brace, disabled: !hasHeavy },
      { name: 'pinning', label: COMBAT_OPTION_LABELS.pinning },
    ].forEach(opt => {
      const el = createCheckboxOption(app, opt, formInputs, checkboxControls);
      if (el) group.append(el);
    });
    content.append(group);
  }

  // Add general options
  const generalGroup = $('<div class="combat-options__group"></div>');
  generalGroup.append(`<div class="combat-options__header">${localizeOrFallback('WNG.GeneralOptions', 'General')}</div>`);
  
  const calledShotOpt = createCalledShotOption(app, calledShotSelect, calledShotLabel);
  if (calledShotOpt) generalGroup.append(calledShotOpt);
  
  const fullDefOpt = createCheckboxOption(app, { name: 'fullDefence', label: COMBAT_OPTION_LABELS.fullDefence }, formInputs, checkboxControls);
  if (fullDefOpt) generalGroup.append(fullDefOpt);
  
  generalGroup.append(createCoverOption(app, formInputs));
  content.append(generalGroup);

  // Insert into dialog
  const insertionPoint = attackSection.find('hr').first();
  if (insertionPoint.length) {
    details.insertBefore(insertionPoint);
  } else {
    attackSection.append(details);
  }

  // Helper: Create checkbox option
  function createCheckboxOption(app, option, inputMap, controlMap) {
    const input = inputMap.get(option.name);
    if (!input?.length) return null;

    const wrapper = $('<label class="combat-options__option"></label>');
    const checkbox = $('<input type="checkbox" />');
    checkbox.prop('checked', Boolean(input.prop('checked')));
    if (option.disabled) {
      checkbox.prop('disabled', true);
    }
    
    const text = $('<span></span>').text(option.label);
    wrapper.append(checkbox, text);

    // Direct binding - update the actual form input
    checkbox.on('change', (e) => {
      e.stopPropagation();
      const checked = checkbox.prop('checked');
      input.prop('checked', checked);
      handleConflicts(option.name, checked);
      app.render(false);
    });

    controlMap.set(option.name, { checkbox, input });
    return wrapper;
  }

  // Helper: Create called shot option
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

    checkbox.on('change', (e) => {
      e.stopPropagation();
      toggle(checkbox.prop('checked'));
      app.render(false);
    });

    sizeSelect.on('change', () => app.render(false));
    labelInput.on('change', () => app.render(false));

    toggle(Boolean(app.fields.calledShot?.size));
    return wrapper;
  }

  // Helper: Create cover option
  function createCoverOption(app, inputMap) {
    const input = inputMap.get('cover');
    const wrapper = $('<label class="combat-options__option combat-options__option--select"></label>');
    const span = $('<span></span>').text('Cover');
    const select = $('<select></select>');
    
    [
      { value: '', label: 'No Cover' },
      { value: 'half', label: COMBAT_OPTION_LABELS.halfCover },
      { value: 'full', label: COMBAT_OPTION_LABELS.fullCover },
    ].forEach(opt => {
      select.append($('<option></option>').attr('value', opt.value).text(opt.label));
    });
    
    select.val(input?.val() ?? '');
    select.on('change', (e) => {
      e.stopPropagation();
      input.val(select.val());
      app.render(false);
    });
    
    wrapper.append(span, select);
    return wrapper;
  }

  // Helper: Handle conflicts
  function handleConflicts(name, checked) {
    if (!checked) return;
    
    if (name === 'allOutAttack') {
      const fdControl = checkboxControls.get('fullDefence');
      if (fdControl) {
        fdControl.checkbox.prop('checked', false);
        fdControl.input.prop('checked', false);
      }
    } else if (name === 'fullDefence') {
      const aoaControl = checkboxControls.get('allOutAttack');
      if (aoaControl) {
        aoaControl.checkbox.prop('checked', false);
        aoaControl.input.prop('checked', false);
      }
    }
  }

  // Helper: Localization
  function localizeOrFallback(key, fallback) {
    try {
      if (game.i18n?.has?.(key)) {
        return game.i18n.localize(key);
      }
      const localized = game.i18n.localize(key);
      return localized !== key ? localized : fallback;
    } catch {
      return fallback;
    }
  }
}
