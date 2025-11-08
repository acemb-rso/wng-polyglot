const MODULE_ID = "wng-CombatExtender";
const MODULE_LABEL = "WNG Combat Extender";
const API_NAMESPACE = "wngCombatExtender";

const log = (level, message, ...data) => {
  const logger = console[level] ?? console.log;
  logger(`${MODULE_LABEL} | ${message}`, ...data);
};
const logError = (...args) => log("error", ...args);

let lastDialogState = null;

function ensureApi() {
  if (!game[API_NAMESPACE]) {
    game[API_NAMESPACE] = {};
  }
  return game[API_NAMESPACE];
}

function encodeActorSelection(actor) {
  const actorId = actor?.id ?? null;
  if (!actorId) return null;
  return `actor:${actorId}`;
}

function encodeTokenSelection(token) {
  if (!token) return null;
  const document = token?.document ?? token;
  const uuid = document?.uuid ?? null;
  if (uuid) return `token:${uuid}`;
  return encodeActorSelection((token?.actor ?? document?.actor) ?? null);
}

function normalizeSelectionValue(value) {
  if (!value || typeof value !== "string") return null;
  if (value.startsWith("token:") || value.startsWith("actor:")) return value;
  return `actor:${value}`;
}

function buildOptionFromActor(actor, { hint } = {}) {
  if (!actor?.id) return null;
  const name = actor.name ?? game.i18n.localize("WNGCE.Common.UnknownActor") ?? "Unknown";
  return {
    value: encodeActorSelection(actor),
    name,
    hint: hint ?? "",
    actor
  };
}

function buildOptionFromToken(token) {
  const document = token?.document ?? token;
  const actor = (token?.actor ?? document?.actor) ?? null;
  if (!actor) return null;
  const tokenName = (token?.name ?? document?.name) ?? actor.name ?? game.i18n.localize("WNGCE.Common.UnknownActor");
  const actorName = actor.name ?? tokenName;
  const hint = tokenName !== actorName ? actorName : "";
  return {
    value: encodeTokenSelection(token),
    name: tokenName,
    hint,
    actor,
    token
  };
}

function buildOptionFromSelection(value) {
  const normalized = normalizeSelectionValue(value);
  if (!normalized) return null;

  if (normalized.startsWith("token:")) {
    const uuid = normalized.slice(6);
    try {
      const tokenDocument = resolveTokenDocumentSync(uuid);
      const token = tokenDocument?.object ?? null;
      const actor = tokenDocument?.actor ?? token?.actor ?? null;
      if (!actor) return null;
      const option = buildOptionFromToken(token ?? tokenDocument);
      if (option) {
        option.value = normalized;
        return option;
      }
      const name = tokenDocument?.name ?? actor.name ?? game.i18n.localize("WNGCE.Common.UnknownActor");
      return {
        value: normalized,
        name,
        hint: "",
        actor
      };
    } catch (err) {
      logError(`Failed to resolve token selection ${uuid}`, err);
      return null;
    }
  }

  const actorId = normalized.slice(6);
  const actor = game.actors?.get(actorId) ?? null;
  if (!actor) return null;
  const option = buildOptionFromActor(actor);
  if (option) {
    option.value = normalized;
  }
  return option;
}

function isTokenVisibleToUser(token, user) {
  if (!token) return false;
  if (user?.isGM) return true;
  if (token.isVisible === false) return false;
  if (token.visible === false) return false;
  if (token.document?.hidden) return false;
  return true;
}

function findPrimaryTokenForUser(user) {
  const controlled = Array.from(canvas?.tokens?.controlled ?? []);
  if (controlled.length) return controlled[0];

  const characterTokens = user?.character?.getActiveTokens?.(true, true) ?? [];
  if (characterTokens.length) return characterTokens[0];

  const owned = (canvas?.tokens?.placeables ?? []).filter((token) => token?.isOwner);
  if (owned.length) return owned[0];

  return null;
}

function collectSceneTokenOptions({ user, includeHidden }) {
  const tokens = canvas?.tokens?.placeables ?? [];
  const options = [];
  const seen = new Set();

  for (const token of tokens) {
    if (!token?.actor) continue;
    if (!includeHidden && !isTokenVisibleToUser(token, user)) continue;
    const option = buildOptionFromToken(token);
    if (!option) continue;
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    options.push(option);
  }

  options.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang ?? "en"));
  return options;
}

function collectAttackerOptions({ user, initialSelection, lockToInitial = false }) {
  const isGM = user?.isGM;
  const options = [];
  const seen = new Set();
  const addOption = (option) => {
    if (!option) return;
    if (seen.has(option.value)) return;
    seen.add(option.value);
    options.push(option);
  };

  if (initialSelection) {
    addOption(buildOptionFromSelection(initialSelection));
    if (!isGM || lockToInitial) {
      options.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang ?? "en"));
      return options;
    }
  }

  if (!isGM) {
    const primaryToken = findPrimaryTokenForUser(user);
    if (primaryToken) {
      addOption(buildOptionFromToken(primaryToken));
    } else if (!options.length && user?.character) {
      addOption(buildOptionFromActor(user.character));
    }
    options.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang ?? "en"));
    return options;
  }

  const controlled = Array.from(canvas?.tokens?.controlled ?? []);
  for (const token of controlled) {
    addOption(buildOptionFromToken(token));
  }

  if (!options.length) {
    const targeted = Array.from(user?.targets ?? []);
    for (const token of targeted) {
      addOption(buildOptionFromToken(token));
    }
  }

  if (!options.length) {
    const sceneTokens = collectSceneTokenOptions({ user, includeHidden: true });
    for (const option of sceneTokens) {
      addOption(option);
    }
  }

  if (!options.length) {
    for (const actor of game.actors ?? []) {
      addOption(buildOptionFromActor(actor));
    }
  }

  options.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang ?? "en"));
  return options;
}

function collectDefenderOptions({ user }) {
  return collectSceneTokenOptions({ user, includeHidden: user?.isGM ?? false });
}

function buildTraitOptions() {
  const skillEntries = Object.entries(game?.wng?.config?.skills ?? {});
  const attrEntries = Object.entries(game?.wng?.config?.attributes ?? {});
  const attributeAbbrev = game?.wng?.config?.attributeAbbrev ?? {};

  const localized = [];

  for (const [key, labelKey] of skillEntries) {
    const label = game.i18n.localize(labelKey ?? key);
    const attributeKey = game?.wng?.config?.skillAttribute?.[key];
    const attributeLabel = attributeKey ? game.i18n.localize(attributeAbbrev?.[attributeKey] ?? attributeKey) : null;
    localized.push({
      value: `skill:${key}`,
      key,
      type: "skill",
      label: attributeLabel ? `${label} (${attributeLabel})` : label
    });
  }

  for (const [key, labelKey] of attrEntries) {
    const label = game.i18n.localize(labelKey ?? key);
    localized.push({
      value: `attribute:${key}`,
      key,
      type: "attribute",
      label
    });
  }

  localized.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang ?? "en"));
  return localized;
}

function getActorTraitValue(actor, traitType, traitKey) {
  if (!actor || !traitType || !traitKey) return 0;
  try {
    if (traitType === "skill") {
      return Number(foundry.utils.getProperty(actor.system, `skills.${traitKey}.total`)) || 0;
    }
    if (traitType === "attribute") {
      return Number(foundry.utils.getProperty(actor.system, `attributes.${traitKey}.total`)) || 0;
    }
  } catch (err) {
    logError(`Failed to read ${traitType} ${traitKey} from ${actor?.name ?? "unknown"}`, err);
  }
  return 0;
}

function sanitizeInteger(value, fallback = 0) {
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isFinite(num)) return fallback;
  return Math.floor(num);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createRollTerms(poolDice, wrathDice) {
  const terms = [];
  const hasPool = poolDice > 0;
  const hasWrath = wrathDice > 0;

  if (hasPool) {
    terms.push(new game.wng.dice.PoolDie({ number: poolDice, faces: 6 }));
  }
  if (hasPool && hasWrath) {
    terms.push(new foundry.dice.terms.OperatorTerm({ operator: "+" }));
  }
  if (hasWrath) {
    terms.push(new game.wng.dice.WrathDie({ number: wrathDice, faces: 6 }));
  }

  return terms;
}

function extractDiceResults(roll) {
  if (!roll) return [];
  return roll.dice.flatMap((term) => Array.isArray(term.results) ? term.results.filter((result) => result?.active !== false) : []);
}

function summarizeRoll({ actor, roll, traitLabel, totalDice, wrathDice, bonusDice, baseDice }) {
  const results = extractDiceResults(roll);
  const icons = results.reduce((sum, result) => sum + (Number(result?.value) || 0), 0);
  const iconCount = results.filter((result) => result?.name === "icon" || result?.name === "wrath-critical").length;
  const wrathCritical = results.some((result) => result?.name === "wrath-critical");
  const wrathComplication = results.some((result) => result?.name === "wrath-complication");

  return {
    actor,
    traitLabel,
    roll,
    icons,
    shiftPotential: 0,
    wrathCritical,
    wrathComplication,
    iconCount,
    totalDice,
    wrathDice,
    bonusDice,
    baseDice,
    results
  };
}

async function executeTraitRoll({ actor, traitType, traitKey, bonusDice, wrathDice }) {
  const baseDice = getActorTraitValue(actor, traitType, traitKey);
  const totalDice = Math.max(0, baseDice + bonusDice);
  const normalizedWrath = clamp(wrathDice ?? 0, 0, totalDice);
  const poolDice = Math.max(0, totalDice - normalizedWrath);

  const terms = createRollTerms(poolDice, normalizedWrath);
  let roll = null;
  if (terms.length) {
    roll = Roll.fromTerms(terms);
    await roll.evaluate({ async: true });
  }

  const traitLabel = formatTraitLabel(traitType, traitKey);
  return summarizeRoll({
    actor,
    roll,
    traitLabel,
    totalDice,
    wrathDice: normalizedWrath,
    bonusDice,
    baseDice
  });
}

function formatTraitLabel(traitType, traitKey) {
  if (!traitKey) return game.i18n.localize("WNGCE.ContestedRoll.UnknownTrait");
  if (traitType === "skill") {
    const labelKey = game?.wng?.config?.skills?.[traitKey];
    if (labelKey) return game.i18n.localize(labelKey);
  }
  if (traitType === "attribute") {
    const labelKey = game?.wng?.config?.attributes?.[traitKey];
    if (labelKey) return game.i18n.localize(labelKey);
  }
  return traitKey;
}

function buildDialogContent(state, { attackerOptions, defenderOptions }, traitOptions) {
  const renderOptions = (options, selectedValue) => options.map((option) => {
    const hint = option.hint ? ` data-tooltip="${foundry.utils.escapeHTML(option.hint)}"` : "";
    return `<option value="${option.value}"${option.value === selectedValue ? " selected" : ""}${hint}>${foundry.utils.escapeHTML(option.name)}</option>`;
  }).join("");

  const traitOptionsHtml = (selectedValue) => traitOptions.map((option) => {
    return `<option value="${option.value}"${option.value === selectedValue ? " selected" : ""}>${foundry.utils.escapeHTML(option.label)}</option>`;
  }).join("");

  return `
    <form class="wngce-contested-form">
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.Attacker")}</label>
        <select name="attacker" required>${renderOptions(attackerOptions, state.attacker)}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.AttackerTrait")}</label>
        <select name="attackerTrait" required>${traitOptionsHtml(state.attackerTrait)}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.AttackerBonusDice")}</label>
        <input type="number" name="attackerBonus" value="${state.attackerBonus ?? 0}" step="1" />
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.AttackerWrath")}</label>
        <input type="number" name="attackerWrath" value="${state.attackerWrath ?? 0}" min="0" step="1" />
      </div>
      <hr />
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.Defender")}</label>
        <select name="defender" required>${renderOptions(defenderOptions, state.defender)}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.DefenderTrait")}</label>
        <select name="defenderTrait" required>${traitOptionsHtml(state.defenderTrait)}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.DefenderBonusDice")}</label>
        <input type="number" name="defenderBonus" value="${state.defenderBonus ?? 0}" step="1" />
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.DefenderWrath")}</label>
        <input type="number" name="defenderWrath" value="${state.defenderWrath ?? 0}" min="0" step="1" />
      </div>
      <hr />
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.Initiator")}</label>
        <select name="initiator" required>
          <option value="attacker"${state.initiator === "attacker" ? " selected" : ""}>${game.i18n.localize("WNGCE.ContestedRoll.InitiatorAttacker")}</option>
          <option value="defender"${state.initiator === "defender" ? " selected" : ""}>${game.i18n.localize("WNGCE.ContestedRoll.InitiatorDefender")}</option>
        </select>
      </div>
      <p class="notes">${game.i18n.localize("WNGCE.ContestedRoll.DialogHint")}</p>
    </form>
  `;
}

function parseTraitSelection(value) {
  if (!value) return { type: null, key: null };
  const [type, key] = value.split(":");
  if (!type || !key) return { type: null, key: null };
  if (type !== "skill" && type !== "attribute") return { type: null, key: null };
  return { type, key };
}

function resolveSelection(selection) {
  const normalized = normalizeSelectionValue(selection);
  if (!normalized) {
    return { actor: null, tokenDocument: null, token: null };
  }

  if (normalized.startsWith("token:")) {
    const uuid = normalized.slice(6);
    try {
      const tokenDocument = resolveTokenDocumentSync(uuid);
      const token = tokenDocument?.object ?? null;
      const actor = tokenDocument?.actor ?? token?.actor ?? null;
      return { actor, tokenDocument, token };
    } catch (err) {
      logError(`Failed to resolve token selection ${uuid}`, err);
      return { actor: null, tokenDocument: null, token: null };
    }
  }

  const actorId = normalized.slice(6);
  const actor = game.actors?.get(actorId) ?? null;
  return { actor, tokenDocument: null, token: null };
}

function resolveTokenDocumentSync(uuid) {
  if (!uuid) return null;
  if (typeof fromUuidSync === "function") {
    return fromUuidSync(uuid);
  }
  const parts = uuid.split?.(".") ?? [];
  if (parts.length >= 4 && parts[0] === "Scene") {
    const sceneId = parts[1];
    const tokenId = parts[3];
    const scene = game.scenes?.get(sceneId) ?? null;
    if (scene) {
      return scene.tokens?.get(tokenId) ?? null;
    }
  }
  return null;
}

async function buildChatSummary(attackerResult, defenderResult, { initiator } = {}) {
  const attackerRollHtml = attackerResult.roll ? await attackerResult.roll.render() : "";
  const defenderRollHtml = defenderResult.roll ? await defenderResult.roll.render() : "";

  const attackerIcons = attackerResult.icons;
  const defenderIcons = defenderResult.icons;
  let winner = null;
  let loser = null;
  let margin = 0;
  let tieBreaker = false;

  if (attackerIcons > defenderIcons) {
    winner = attackerResult;
    loser = defenderResult;
    margin = attackerIcons - defenderIcons;
  } else if (defenderIcons > attackerIcons) {
    winner = defenderResult;
    loser = attackerResult;
    margin = defenderIcons - attackerIcons;
  } else {
    tieBreaker = true;
    if (initiator === "defender") {
      winner = defenderResult;
      loser = attackerResult;
    } else {
      winner = attackerResult;
      loser = defenderResult;
    }
  }

  if (winner) {
    winner.shiftPotential = margin;
  }
  if (loser) {
    loser.shiftPotential = 0;
  }

  const formatHeader = (result) => {
    const actorName = foundry.utils.escapeHTML(result.actor?.name ?? game.i18n.localize("WNGCE.ContestedRoll.UnknownActor"));
    const trait = foundry.utils.escapeHTML(result.traitLabel ?? "");
    return `${actorName} – ${trait}`;
  };

  const formatTags = (result) => {
    const tags = [];
    if (result.wrathCritical) tags.push(game.i18n.localize("WNGCE.ContestedRoll.TagWrathCrit"));
    if (result.wrathComplication) tags.push(game.i18n.localize("WNGCE.ContestedRoll.TagWrathComplication"));
    if (result.shiftPotential > 0) tags.push(game.i18n.format("WNGCE.ContestedRoll.TagShifts", { count: result.shiftPotential }));
    return tags.map((tag) => `<span class="tag">${foundry.utils.escapeHTML(tag)}</span>`).join(" ");
  };

  const renderDetails = (result, rollHtml) => {
    return `
      <header>
        <h3>${formatHeader(result)}</h3>
        <div class="meta">
          <span>${game.i18n.format("WNGCE.ContestedRoll.TotalDice", { count: result.totalDice })}</span>
          <span>${game.i18n.format("WNGCE.ContestedRoll.WrathDice", { count: result.wrathDice })}</span>
          <span>${game.i18n.format("WNGCE.ContestedRoll.Icons", { count: result.icons })}</span>
        </div>
        <div class="tags">${formatTags(result)}</div>
      </header>
      <div class="dice">${rollHtml}</div>
    `;
  };

  return `
    <section class="wngce-contested-summary">
      <div class="result attacker">${renderDetails(attackerResult, attackerRollHtml)}</div>
      <div class="result defender">${renderDetails(defenderResult, defenderRollHtml)}</div>
      <footer>${foundry.utils.escapeHTML((() => {
        if (!winner) return "";
        const name = winner.actor?.name ?? game.i18n.localize("WNGCE.ContestedRoll.UnknownActor");
        if (tieBreaker) {
          return game.i18n.format("WNGCE.ContestedRoll.TieInitiatorLine", { name });
        }
        return game.i18n.format("WNGCE.ContestedRoll.WinnerLine", { name, margin });
      })())}</footer>
    </section>
  `;
}

async function contestedRoll(initial = {}) {
  if (game.system.id !== "wrath-and-glory") {
    ui.notifications?.warn?.(game.i18n.localize("WNGCE.ContestedRoll.WrongSystem"));
    return null;
  }

  const user = game?.user ?? null;
  const hasExplicitAttacker = Object.prototype.hasOwnProperty.call(initial, "attacker");
  const normalizedInitialAttacker = normalizeSelectionValue(initial.attacker ?? lastDialogState?.attacker ?? null);
  const lockToInitialAttacker = Boolean(user?.isGM && hasExplicitAttacker && normalizedInitialAttacker);
  const attackerOptions = collectAttackerOptions({
    user,
    initialSelection: normalizedInitialAttacker,
    lockToInitial: lockToInitialAttacker
  });
  if (!attackerOptions.length) {
    ui.notifications?.warn?.(game.i18n.localize("WNGCE.ContestedRoll.NoActors"));
    return null;
  }

  const traitOptions = buildTraitOptions();
  if (!traitOptions.length) {
    ui.notifications?.warn?.(game.i18n.localize("WNGCE.ContestedRoll.NoTraits"));
    return null;
  }

  const defenderOptions = collectDefenderOptions({ user });
  if (!defenderOptions.length) {
    ui.notifications?.warn?.(game.i18n.localize("WNGCE.ContestedRoll.NoOpposition"));
    return null;
  }

  const targets = Array.from(user?.targets ?? []);
  const targetedSelection = encodeTokenSelection(targets[0] ?? null);

  let attackerDefault = normalizedInitialAttacker;
  if (!attackerDefault || !attackerOptions.some((option) => option.value === attackerDefault)) {
    attackerDefault = attackerOptions[0]?.value ?? null;
  }

  let defenderDefault = normalizeSelectionValue(initial.defender ?? lastDialogState?.defender ?? targetedSelection ?? null);
  if (targetedSelection && defenderOptions.some((option) => option.value === targetedSelection)) {
    defenderDefault = targetedSelection;
  }
  if (!defenderDefault || !defenderOptions.some((option) => option.value === defenderDefault)) {
    defenderDefault = defenderOptions[0]?.value ?? attackerDefault;
  }

  const defaultTrait = traitOptions[0]?.value ?? null;

  const state = {
    attacker: attackerDefault,
    defender: defenderDefault,
    attackerTrait: initial.attackerTrait ?? lastDialogState?.attackerTrait ?? defaultTrait,
    defenderTrait: initial.defenderTrait ?? lastDialogState?.defenderTrait ?? defaultTrait,
    attackerBonus: initial.attackerBonus ?? lastDialogState?.attackerBonus ?? 0,
    defenderBonus: initial.defenderBonus ?? lastDialogState?.defenderBonus ?? 0,
    attackerWrath: initial.attackerWrath ?? lastDialogState?.attackerWrath ?? 0,
    defenderWrath: initial.defenderWrath ?? lastDialogState?.defenderWrath ?? 0,
    initiator: initial.initiator ?? lastDialogState?.initiator ?? "attacker"
  };

  const content = buildDialogContent(state, { attackerOptions, defenderOptions }, traitOptions);

  return new Promise((resolve) => {
    new Dialog({
      title: game.i18n.localize("WNGCE.ContestedRoll.DialogTitle"),
      content,
      buttons: {
        roll: {
          icon: "<i class=\"fas fa-dice\"></i>",
          label: game.i18n.localize("WNGCE.ContestedRoll.Roll"),
          callback: async (html) => {
            try {
              const element = html instanceof jQuery ? html[0] : html;
              const form = element?.querySelector?.("form") ?? element;
              const data = new FormData(form);
              const attackerId = data.get("attacker");
              const defenderId = data.get("defender");
              const attackerTraitValue = data.get("attackerTrait");
              const defenderTraitValue = data.get("defenderTrait");
              const attackerBonus = sanitizeInteger(data.get("attackerBonus"));
              const defenderBonus = sanitizeInteger(data.get("defenderBonus"));
              const attackerWrath = clamp(sanitizeInteger(data.get("attackerWrath"), 0), 0, 100);
              const defenderWrath = clamp(sanitizeInteger(data.get("defenderWrath"), 0), 0, 100);
              const initiator = data.get("initiator") === "defender" ? "defender" : "attacker";

              const attackerTrait = parseTraitSelection(attackerTraitValue);
              const defenderTrait = parseTraitSelection(defenderTraitValue);

              if (!attackerId || !defenderId || !attackerTrait.key || !defenderTrait.key) {
                ui.notifications?.error?.(game.i18n.localize("WNGCE.ContestedRoll.InvalidSelection"));
                resolve(null);
                return;
              }

              lastDialogState = {
                attacker: attackerId,
                defender: defenderId,
                attackerTrait: attackerTraitValue,
                defenderTrait: defenderTraitValue,
                attackerBonus,
                defenderBonus,
                attackerWrath,
                defenderWrath,
                initiator
              };

              const attackerSelection = resolveSelection(attackerId);
              const defenderSelection = resolveSelection(defenderId);
              const attackerActor = attackerSelection.actor;
              const defenderActor = defenderSelection.actor;

              const [attackerResult, defenderResult] = await Promise.all([
                executeTraitRoll({
                  actor: attackerActor,
                  traitType: attackerTrait.type,
                  traitKey: attackerTrait.key,
                  bonusDice: attackerBonus,
                  wrathDice: attackerWrath
                }),
                executeTraitRoll({
                  actor: defenderActor,
                  traitType: defenderTrait.type,
                  traitKey: defenderTrait.key,
                  bonusDice: defenderBonus,
                  wrathDice: defenderWrath
                })
              ]);

              const summaryHtml = await buildChatSummary(attackerResult, defenderResult, { initiator });
              const speakerActor = attackerActor ?? defenderActor ?? null;
              const speakerToken = attackerSelection.tokenDocument ?? defenderSelection.tokenDocument ?? undefined;
              const speakerScene = speakerToken?.parent ?? undefined;
              const speaker = ChatMessage.getSpeaker({
                actor: speakerActor ?? undefined,
                token: speakerToken,
                scene: speakerScene
              }) ?? undefined;
              await ChatMessage.create({
                content: summaryHtml,
                speaker,
                flags: {
                  [MODULE_ID]: {
                    contested: true,
                    attacker:
                      attackerSelection.tokenDocument?.uuid ?? attackerActor?.uuid ?? attackerActor?.id ?? null,
                    defender:
                      defenderSelection.tokenDocument?.uuid ?? defenderActor?.uuid ?? defenderActor?.id ?? null,
                    initiator
                  }
                }
              });
              resolve({ attackerResult, defenderResult, initiator });
            } catch (err) {
              logError("Failed to complete contested roll", err);
              ui.notifications?.error?.(game.i18n.localize("WNGCE.ContestedRoll.RollFailure"));
              resolve(null);
            }
          }
        },
        cancel: {
          label: game.i18n.localize("Cancel")
        }
      },
      default: "roll",
      render: (html) => {
        const element = html instanceof jQuery ? html[0] : html;
        element?.querySelector?.("select[name=\"attacker\"]")?.focus?.();
      },
      close: () => {
        resolve(null);
      }
    }).render(true);
  });
}

function injectActorSheetButton(app, html) {
  try {
    if (game.system.id !== "wrath-and-glory") return;
    const element = html instanceof jQuery ? html[0] : html;
    const header =
      element?.querySelector?.(
        ".sheet-header .header-actions, .sheet-header .header-buttons, .sheet-header .header-controls, .sheet-header"
      ) ?? null;
    if (!header) return;
    if (header.querySelector('[data-wngce-contested]')) return;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.wngceContested = "true";
    button.classList.add("wngce-contested-button");
    button.innerHTML = `<i class="fas fa-balance-scale"></i> ${foundry.utils.escapeHTML(game.i18n.localize("WNGCE.ContestedRoll.ButtonLabel"))}`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      contestedRoll({ attacker: app.actor?.id });
    });

    header.appendChild(button);
  } catch (err) {
    logError("Failed to inject contested roll button", err);
  }
}

Hooks.once("init", () => {
  const api = ensureApi();
  api.contestedRoll = contestedRoll;
  for (const hookName of ["renderActorSheet", "renderActorSheetV2", "renderWarhammerActorSheetV2", "renderWnGActorSheet"]) {
    Hooks.on(hookName, injectActorSheetButton);
  }
  log("log", "Contested roll helper initialised");
});

export { contestedRoll };
