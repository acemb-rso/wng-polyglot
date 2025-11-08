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

function collectActorOptions() {
  const seen = new Map();
  const pushActor = (actor, hint) => {
    if (!actor?.id || seen.has(actor.id)) return;
    const name = actor.name ?? game.i18n.localize("WNGCE.Common.UnknownActor") ?? "Unknown";
    seen.set(actor.id, {
      id: actor.id,
      name,
      hint: hint ?? "",
      actor
    });
  };

  const targeted = Array.from(game?.user?.targets ?? []);
  for (const token of targeted) {
    if (!token?.actor) continue;
    pushActor(token.actor, game.i18n.localize("WNGCE.ContestedRoll.TargetHint"));
  }

  const controlled = Array.from(canvas?.tokens?.controlled ?? []);
  for (const token of controlled) {
    if (!token?.actor) continue;
    pushActor(token.actor, game.i18n.localize("WNGCE.ContestedRoll.ControlledHint"));
  }

  const combatants = Array.from(game?.combat?.combatants ?? []);
  for (const combatant of combatants) {
    if (!combatant?.actor) continue;
    pushActor(combatant.actor, game.i18n.localize("WNGCE.ContestedRoll.CombatantHint"));
  }

  for (const actor of game.actors ?? []) {
    pushActor(actor);
  }

  const options = Array.from(seen.values());
  options.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang ?? "en"));
  return options;
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

function summarizeRoll({ actor, roll, traitLabel, dn, totalDice, wrathDice, bonusDice, baseDice }) {
  const results = extractDiceResults(roll);
  const successes = results.reduce((sum, result) => sum + (Number(result?.value) || 0), 0);
  const iconCount = results.filter((result) => result?.name === "icon" || result?.name === "wrath-critical").length;
  const wrathCritical = results.some((result) => result?.name === "wrath-critical");
  const wrathComplication = results.some((result) => result?.name === "wrath-complication");
  const shiftPotential = Math.max(0, successes - dn);

  return {
    actor,
    traitLabel,
    roll,
    successes,
    dn,
    shiftPotential,
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

async function executeTraitRoll({ actor, traitType, traitKey, bonusDice, dn, wrathDice }) {
  const baseDice = getActorTraitValue(actor, traitType, traitKey);
  const totalDice = Math.max(0, baseDice + bonusDice);
  const normalizedWrath = clamp(wrathDice ?? 1, 0, totalDice);
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
    dn,
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

function buildDialogContent(state, actorOptions, traitOptions) {
  const actorOptionsHtml = (selectedId) => actorOptions.map((option) => {
    const hint = option.hint ? ` data-tooltip="${foundry.utils.escapeHTML(option.hint)}"` : "";
    return `<option value="${option.id}"${option.id === selectedId ? " selected" : ""}${hint}>${foundry.utils.escapeHTML(option.name)}</option>`;
  }).join("");

  const traitOptionsHtml = (selectedValue) => traitOptions.map((option) => {
    return `<option value="${option.value}"${option.value === selectedValue ? " selected" : ""}>${foundry.utils.escapeHTML(option.label)}</option>`;
  }).join("");

  return `
    <form class="wngce-contested-form">
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.Attacker")}</label>
        <select name="attacker" required>${actorOptionsHtml(state.attacker)}</select>
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
        <input type="number" name="attackerWrath" value="${state.attackerWrath ?? 1}" min="0" step="1" />
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.AttackerDn")}</label>
        <input type="number" name="attackerDn" value="${state.attackerDn ?? 3}" min="0" step="1" />
      </div>
      <hr />
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.Defender")}</label>
        <select name="defender" required>${actorOptionsHtml(state.defender)}</select>
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
        <input type="number" name="defenderWrath" value="${state.defenderWrath ?? 1}" min="0" step="1" />
      </div>
      <div class="form-group">
        <label>${game.i18n.localize("WNGCE.ContestedRoll.DefenderDn")}</label>
        <input type="number" name="defenderDn" value="${state.defenderDn ?? 3}" min="0" step="1" />
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

function resolveActor(actorId) {
  if (!actorId) return null;
  return game.actors?.get(actorId) ?? null;
}

async function buildChatSummary(attackerResult, defenderResult) {
  const attackerRollHtml = attackerResult.roll ? await attackerResult.roll.render() : "";
  const defenderRollHtml = defenderResult.roll ? await defenderResult.roll.render() : "";

  const winner = attackerResult.successes === defenderResult.successes
    ? null
    : (attackerResult.successes > defenderResult.successes ? attackerResult : defenderResult);
  const margin = winner ? Math.abs(attackerResult.successes - defenderResult.successes) : 0;

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
          <span>${game.i18n.format("WNGCE.ContestedRoll.Successes", { count: result.successes, dn: result.dn })}</span>
        </div>
        <div class="tags">${formatTags(result)}</div>
      </header>
      <div class="dice">${rollHtml}</div>
    `;
  };

  const winnerLine = winner
    ? game.i18n.format("WNGCE.ContestedRoll.WinnerLine", {
        name: winner.actor?.name ?? game.i18n.localize("WNGCE.ContestedRoll.UnknownActor"),
        margin
      })
    : game.i18n.localize("WNGCE.ContestedRoll.TieLine");

  return `
    <section class="wngce-contested-summary">
      <div class="result attacker">${renderDetails(attackerResult, attackerRollHtml)}</div>
      <div class="result defender">${renderDetails(defenderResult, defenderRollHtml)}</div>
      <footer>${foundry.utils.escapeHTML(winnerLine)}</footer>
    </section>
  `;
}

async function contestedRoll(initial = {}) {
  if (game.system.id !== "wrath-and-glory") {
    ui.notifications?.warn?.(game.i18n.localize("WNGCE.ContestedRoll.WrongSystem"));
    return null;
  }

  const actorOptions = collectActorOptions();
  if (!actorOptions.length) {
    ui.notifications?.warn?.(game.i18n.localize("WNGCE.ContestedRoll.NoActors"));
    return null;
  }

  const traitOptions = buildTraitOptions();
  if (!traitOptions.length) {
    ui.notifications?.warn?.(game.i18n.localize("WNGCE.ContestedRoll.NoTraits"));
    return null;
  }

  const controlled = canvas?.tokens?.controlled ?? [];
  const targets = Array.from(game?.user?.targets ?? []);
  const attackerDefault = initial.attacker ?? lastDialogState?.attacker ?? controlled[0]?.actor?.id ?? actorOptions[0]?.id ?? null;
  const defenderDefault = initial.defender ?? lastDialogState?.defender ?? targets[0]?.actor?.id ?? actorOptions[1]?.id ?? attackerDefault;

  const defaultTrait = traitOptions[0]?.value ?? null;

  const state = {
    attacker: attackerDefault,
    defender: defenderDefault,
    attackerTrait: initial.attackerTrait ?? lastDialogState?.attackerTrait ?? defaultTrait,
    defenderTrait: initial.defenderTrait ?? lastDialogState?.defenderTrait ?? defaultTrait,
    attackerBonus: initial.attackerBonus ?? lastDialogState?.attackerBonus ?? 0,
    defenderBonus: initial.defenderBonus ?? lastDialogState?.defenderBonus ?? 0,
    attackerWrath: initial.attackerWrath ?? lastDialogState?.attackerWrath ?? 1,
    defenderWrath: initial.defenderWrath ?? lastDialogState?.defenderWrath ?? 1,
    attackerDn: initial.attackerDn ?? lastDialogState?.attackerDn ?? 3,
    defenderDn: initial.defenderDn ?? lastDialogState?.defenderDn ?? 3
  };

  const content = buildDialogContent(state, actorOptions, traitOptions);

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
              const attackerWrath = clamp(sanitizeInteger(data.get("attackerWrath"), 1), 0, 100);
              const defenderWrath = clamp(sanitizeInteger(data.get("defenderWrath"), 1), 0, 100);
              const attackerDn = Math.max(0, sanitizeInteger(data.get("attackerDn"), 3));
              const defenderDn = Math.max(0, sanitizeInteger(data.get("defenderDn"), 3));

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
                attackerDn,
                defenderDn
              };

              const attackerActor = resolveActor(attackerId);
              const defenderActor = resolveActor(defenderId);

              const [attackerResult, defenderResult] = await Promise.all([
                executeTraitRoll({
                  actor: attackerActor,
                  traitType: attackerTrait.type,
                  traitKey: attackerTrait.key,
                  bonusDice: attackerBonus,
                  dn: attackerDn,
                  wrathDice: attackerWrath
                }),
                executeTraitRoll({
                  actor: defenderActor,
                  traitType: defenderTrait.type,
                  traitKey: defenderTrait.key,
                  bonusDice: defenderBonus,
                  dn: defenderDn,
                  wrathDice: defenderWrath
                })
              ]);

              const summaryHtml = await buildChatSummary(attackerResult, defenderResult);
              const speakerActor = attackerActor ?? defenderActor ?? null;
              const speaker = ChatMessage.getSpeaker({ actor: speakerActor }) ?? undefined;
              await ChatMessage.create({
                content: summaryHtml,
                speaker,
                flags: {
                  [MODULE_ID]: {
                    contested: true,
                    attacker: attackerActor?.uuid ?? attackerActor?.id ?? null,
                    defender: defenderActor?.uuid ?? defenderActor?.id ?? null
                  }
                }
              });
              resolve({ attackerResult, defenderResult });
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
    const header = element?.querySelector?.(".sheet-header .header-actions, .sheet-header .header-buttons, .sheet-header .header-controls");
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
  Hooks.on("renderActorSheet", injectActorSheetButton);
  log("log", "Contested roll helper initialised");
});

export { contestedRoll };
