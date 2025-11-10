// ===== 0) Require selection =====
const targets = canvas.tokens.controlled;
if (!targets.length) return ui.notifications.warn("Select at least one token.");

// ===== 1) Journal links for rules (edit as needed) =====
const UUID_BY_LABEL = {
  "Bleeding":   "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.Jd7WNdMDKbRKRUZw",
  "Blinded":    "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.Z60kXcB9yrxH4yVg",
  "Dead":       "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.lHk7CsRuHABSE2dO",
  "Dying":      "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.lHk7CsRuHABSE2dO",  
  "Exhausted":  "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.NdTCxcy0A6JWwO1p",
  "Fear":       "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.W9lXP2sytVlaojzj",
  "Frenzied":   "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.x5l2ljTlQGuUEddC",
  "Hindered":   "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.UOnu7jt3sCCg25Vp",
  "On Fire":    "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.HNLBsjfG5CAueoYo",
  "Pinned":     "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.0pOR1ju4MJmsSYlP",
  "Poisoned":   "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.GGlRYHK7gNuXJBZK",
  "Prone":      "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.eusBKHM8P62pDFdj",
  "Restrained": "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.o0KWgke6XXhvt6I2",
  "Staggered":  "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.0HYfCK6dHSaHVJEf",
  "Terror":     "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.Cvn714SkD40NlN0G",
  "Vulnerable": "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.d902T2RTJxj2qmou",
  "Wounded":    "JournalEntry.FWVnJvg0Gy7IMzO7.JournalEntryPage.lHk7CsRuHABSE2dO",
  "Full Defense": "",
  "Half Cover": "",
  "Full Cover": ""
};

// Canonical labels and their status slugs (ids)
const LABEL_TO_ID = {
  "Bleeding": "bleeding",
  "Blinded": "blinded",
  "Dead": "dead",
  "Dying": "dying",
  "Exhausted": "exhausted",
  "Fear": "fear",
  "Frenzied": "frenzied",
  "Hindered": "hindered",
  "On Fire": "onfire",
  "Pinned": "pinned",  
  "Poisoned": "poisoned",
  "Prone": "prone",
  "Restrained": "restrained",
  "Staggered": "staggered",
  "Terror": "terror",
  "Vulnerable": "vulnerable",
  "Wounded": "wounded",
  "Full Defense": "full-defence",
  "Half Cover": "halfCover",
  "Full Cover": "fullCover"
};

const sysId = game.system.id;

// ===== NEW: numeric behavior parity with Effect Manager =====
// Which conditions apply DN via numeric value
const NEEDS_VALUE_DN = new Set(["hindered", "vulnerable"]);
// Which conditions track a numeric level without DN change
const TRACK_VALUE_ONLY = new Set(["poisoned", "terror", "fear"]);

// Auto-detect the actor DN modifier path (mirrors Effect Manager)
const DN_PATHS = ["system.modifiers.dn","system.dn.mod","system.attributes.dn.mod","system.combat.dn.mod","system.dn.valueMod"];
function detectDnPath(actor) {
  for (const p of DN_PATHS) {
    const v = getProperty(actor, p);
    if (v !== undefined && (typeof v === "number" || v === null)) return p;
  }
  return "system.dn.mod";
}

// ===== 2) Helpers =====
function getSystemConditionDef(id, label) {
  const statusDefs = CONFIG.statusEffects ?? [];
  const systemDefs = Object.values(game.wng?.config?.systemEffects ?? {});
  const arr = statusDefs.concat(systemDefs);
  const norm = s => String(s ?? "").toLowerCase();

  let def = arr.find(e => norm(e.id) === norm(id));
  if (!def) def = arr.find(e => Array.isArray(e.statuses) && e.statuses.some(s => norm(s) === norm(id)));
  if (!def) def = arr.find(e => norm(e.name ?? e.label) === norm(label));
  if (!def) def = arr.find(e => norm((e.label ?? e.name ?? "").replace(/\s+/g, "")) === norm(id));
  return def ? foundry.utils.deepClone(def) : null;
}

function getConditionImg(id, label) {
  const def = getSystemConditionDef(id, label);
  return def?.img ?? def?.icon ?? "icons/svg/aura.svg";
}

function actorHasStatus(actor, slug, label) {
  const norm = s => String(s ?? "").toLowerCase();
  return actor.effects.some(e => {
    const bySlug = e.statuses?.has?.(slug) || Array.isArray(e._source?.statuses) && e._source.statuses.includes(slug);
    return bySlug || norm(e.name) === norm(label);
  });
}

function findActorEffect(actor, slug, label) {
  const norm = s => String(s ?? "").toLowerCase();
  return actor.effects.find(e => {
    const bySlug = e.statuses?.has?.(slug) || Array.isArray(e._source?.statuses) && e._source.statuses.includes(slug);
    return bySlug || norm(e.name) === norm(label);
  }) ?? null;
}

async function promptForValue(label, current = 1) {
  return Dialog.prompt({
    title: `Apply ${label}`,
    label: "Apply",
    rejectClose: true,
    content: `
      <p>Enter a value for <strong>${label}</strong> (default: 1)</p>
      <input type="number" id="val" value="${current}" min="1" step="1" style="width:6em">
    `,
    callback: html => {
      const v = parseInt(html.find("#val").val(), 10);
      return Number.isFinite(v) && v > 0 ? v : 1;
    }
  }).catch(() => 1);
}

async function toggleCondition(actor, id, label, originUuid) {
  const slug = id;
  const existing = findActorEffect(actor, slug, label);
  if (existing) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);
    return `${actor.name}: removed ${label}`;
  }

  // Build from system effect if available
  const def = getSystemConditionDef(id, label);
  let data = def ? def : { name: label, label, img: "icons/svg/aura.svg", statuses: [slug], changes: [] };

  // Normalize & augment
  data.label = data.name ?? data.label ?? label;
  data.icon  = data.img ?? data.icon;
  data.statuses = data.statuses ?? [slug];
  data.disabled = false;
  data.origin = originUuid ? `@${originUuid}` : data.origin ?? null;
  data.flags ??= {};
  data.flags[sysId] ??= {};
  data.flags["wrath-and-glory"] ??= { manualEffectKeys: true };
  data.changes = Array.isArray(data.changes) ? data.changes : [];

  // ===== NEW: numeric handling + DN change for hindered/vulnerable; tracked level for fear/terror/poisoned
  if (NEEDS_VALUE_DN.has(slug) || TRACK_VALUE_ONLY.has(slug)) {
    const value = await promptForValue(label, 1);
    data.flags[sysId].level = value;
    const baseName = data.name ?? data.label ?? label;
    data.name = `${baseName} [${value}]`;
    data.label = data.name;

    if (NEEDS_VALUE_DN.has(slug)) {
      const dnKey = detectDnPath(actor);                          // auto-detect DN path
      data.changes = data.changes.filter(ch => ch?.key !== dnKey); // avoid dupes on clones
      data.changes.push({ key: dnKey, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value }); // DN +value
    }
  }

  // Create this effect
  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);

  // ===== NEW: rule hooks parity (fires only if these IDs are ever used here)
    // Lightweight rule hooks for Dying/Dead
  if (slug === "dying") {
    const hasProne = actor.effects.some(e =>
      (e.statuses?.has?.("prone")) ||
      (Array.isArray(e._source?.statuses) && e._source.statuses.includes("prone")) ||
      (String(e.name ?? "").toLowerCase() === "prone")
    );
    if (!hasProne) {
      const proneDef = getSystemConditionDef("prone", "Prone") ?? { name: "Prone", statuses: ["prone"], img: "icons/svg/aura.svg" };
      await actor.createEmbeddedDocuments("ActiveEffect", [proneDef]);
    }
  }

  if (slug === "dead") {
    const keep = new Set([created?.id]);
    const others = actor.effects.filter(e => !keep.has(e.id)).map(e => e.id);
    if (others.length) await actor.deleteEmbeddedDocuments("ActiveEffect", others);
  }


  return `${actor.name}: applied ${label}`;
}

async function removeAllSelected(actor, slugs) {
  const toDelete = actor.effects
    .filter(e => {
      const sts = e.statuses?.values?.() ? Array.from(e.statuses.values()) : e._source?.statuses ?? [];
      return sts?.some(s => slugs.has(s));
    })
    .map(e => e.id);

  if (toDelete.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
    return `${actor.name}: removed ${toDelete.length} condition(s)`;
  } else {
    return `${actor.name}: nothing to remove`;
  }
}

async function openJournal(uuid) {
  const doc = await fromUuid(uuid); // JournalEntryPage or JournalEntry
  if (!doc) return ui.notifications.warn("Journal page not found.");
  const html = await TextEditor.enrichHTML(doc.text?.content ?? "", { async: true, secrets: game.user.isGM });
  return Dialog.prompt({
    title: `Rules: ${doc.name ?? ""}`,
    label: "Close",
    rejectClose: true,
    content: `<div style="max-height:70vh; overflow:auto; padding-right:4px;">${html}</div>`
  });
}

// ===== 3) UI (icon + label + Open Rules + Remove All) =====
const LABELS = Object.keys(LABEL_TO_ID);

const rows = LABELS.map(label => {
  const id = LABEL_TO_ID[label];
  const img = getConditionImg(id, label);
  const uuid = UUID_BY_LABEL[label] || "";
  return `
    <div class="cond-pill" data-label="${label}" data-id="${id}" data-uuid="${uuid}">
      <span class="left">
        <img class="cond-icon" src="${img}" alt="${label}" />
        <span class="txt">${label}</span>
      </span>
      <span class="right">
        <button type="button" class="open" data-uuid="${uuid}" title="Open Rules" ${uuid ? "" : "disabled"}>
          <i class="fas fa-external-link-alt"></i>
        </button>
      </span>
    </div>`;
}).join("");

const content = `
  <style>
    .cond-list { display:flex; flex-direction:column; gap:6px; max-height:62vh; overflow:auto; padding-right:2px; }
    .cond-pill { display:flex; align-items:center; justify-content:space-between; gap:8px;
      padding:6px 10px; border:1px solid var(--color-border-dark-3);
      border-radius:8px; background:rgba(0,0,0,0.05); cursor:pointer; }
    .cond-pill:hover { background:rgba(0,0,0,0.1); }
    .cond-pill .left { display:flex; align-items:center; gap:8px; flex:1; }
    .cond-icon { width:18px; height:18px; object-fit:contain; }
    .cond-pill .right { flex-shrink:0; }
    .cond-pill .open {
      width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center;
      border:1px solid var(--color-border-dark-3); border-radius:6px;
      background:rgba(0,0,0,0.05); padding:0; margin:0;
    }
    .cond-pill .open:disabled { opacity:.5; cursor:not-allowed; }
    .toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
  </style>
  <div class="toolbar">
    <div><strong>Status Conditions</strong></div>
    <button type="button" class="remove-all">Remove All</button>
  </div>
  <div class="cond-list">${rows}</div>
`;

new Dialog({
  title: "Conditions: Apply / View / Remove",
  content,
  buttons: { close: { label: "Close" } },
  render: html => {
    // Apply/toggle by clicking the row (but NOT the Open Rules button)
    html.find(".cond-pill").on("click", async ev => {
      if (ev.target.closest(".open")) return;
      const el = ev.currentTarget;
      const label = el.dataset.label;
      const id    = el.dataset.id;
      const originUuid = el.dataset.uuid || null;

      const notes = [];
      for (const t of targets) {
        try { notes.push(await toggleCondition(t.document.actor, id, label, originUuid)); }
        catch (e) { console.error(e); notes.push(`${t.name}: ${e.message}`); }
      }
      ui.notifications.info(notes.join("\n"));
    });

    // Open Rules (view-only, never applies)
    html.find(".open").on("click", async ev => {
      ev.stopPropagation();
      const uuid = ev.currentTarget.dataset.uuid;
      if (!uuid) return;
      await openJournal(uuid);
    });

    // Remove All
    html.find(".remove-all").on("click", async () => {
      const slugs = new Set(Object.values(LABEL_TO_ID));
      const notes = [];
      for (const t of targets) {
        try { notes.push(await removeAllSelected(t.document.actor, slugs)); }
        catch (e) { console.error(e); notes.push(`${t.name}: ${e.message}`); }
      }
      ui.notifications.info(notes.join("\n"));
    });
  }
}).render(true);
