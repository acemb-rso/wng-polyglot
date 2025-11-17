export const MODULE_ID = "wng-CombatExtender";
export const MODULE_BASE_PATH = `modules/${MODULE_ID}`;
export const TEMPLATE_BASE_PATH = `${MODULE_BASE_PATH}/templates`;
export const MODULE_LABEL = "WNG Combat Extender";

export const COMBAT_OPTION_LABELS = {
  allOutAttack: "All-Out Attack (+2 Dice / –2 Defence)",
  charge: "Charge (+1 Die, 2× Speed)",
  brace: "Brace (Negate Heavy trait)",
  pinning: "Pinning Attack (No damage, target tests Resolve)",
  halfCover: "Half Cover (+1 Defence)",
  fullCover: "Full Cover (+2 Defence)",
  pistolsInMelee: "Pistols In Melee (+2 DN to Ballistic Skill)",
  calledShotDisarm: "Disarm (No damage; Strength DN = half total damage)",
  disarmNoteHeading: "Disarm Reminder",
  disarmNote: "Roll damage as normal to determine the Strength DN (half the attack's total damage)."
};

export const ENGAGED_TOOLTIP_LABELS = {
  aimSuppressed: "Engaged Opponent (Aim bonus suppressed)",
  shortRangeSuppressed: "Engaged Opponent (Short Range bonus suppressed)",
  rangedBlocked: "Engaged Opponent (Cannot fire non-Pistol ranged weapons)",
  targetNotEngaged: "Engaged Attacker (Targets must be engaged)"
};

export const COVER_DIFFICULTY_VALUES = {
  "": 0,
  half: 1,
  full: 2
};

export const VISION_PENALTIES = {
  twilight: { label: "Vision: Twilight, Light Shadows, Heavy Mist (+1 DN Ranged / +0 DN Melee)", ranged: 1, melee: 0 },
  dim:      { label: "Vision: Very Dim Light, Heavy Rain, Fog, Drifting Smoke (+2 DN Ranged / +1 DN Melee)", ranged: 2, melee: 1 },
  heavy:    { label: "Vision: Heavy Fog, Deployed Smoke, Torrential Storm (+3 DN Ranged / +2 DN Melee)", ranged: 3, melee: 2 },
  darkness: { label: "Vision: Total Darkness, Thermal Smoke (+4 DN Ranged / +3 DN Melee)", ranged: 4, melee: 3 }
};

export const SIZE_MODIFIER_OPTIONS = {
  tiny:        { label: "Tiny Target (+2 DN)", difficulty: 2 },
  small:       { label: "Small Target (+1 DN)", difficulty: 1 },
  average:     { label: "Average Target (No modifier)" },
  large:       { label: "Large Target (+1 Die)", pool: 1 },
  huge:        { label: "Huge Target (+2 Dice)", pool: 2 },
  gargantuan:  { label: "Gargantuan Target (+3 Dice)", pool: 3 }
};

export const SIZE_OPTION_KEYS = new Set(Object.keys(SIZE_MODIFIER_OPTIONS));
export const SIZE_ENGAGEMENT_SEQUENCE = ["tiny", "small", "average", "large", "huge", "gargantuan"];
export const SIZE_AVERAGE_INDEX = SIZE_ENGAGEMENT_SEQUENCE.indexOf("average");

export const ENGAGED_CONDITION_ID = "engaged";
export const ENGAGED_CONDITION_FLAG_SOURCE = "auto-engaged";
export const ENGAGED_CONDITION_CONFIG = {
  id: ENGAGED_CONDITION_ID,
  statuses: [ENGAGED_CONDITION_ID],
  name: "WNGCE.Condition.Engaged",
  img: "icons/skills/melee/weapons-crossed-swords-black-gray.webp"
};

export const PERSISTENT_DAMAGE_CONDITIONS = {
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

export const SLOWED_CONDITIONS = [
  { id: "exhausted", labelKey: "CONDITION.Exhausted" },
  { id: "hindered", labelKey: "CONDITION.Hindered" },
  { id: "restrained", labelKey: "CONDITION.Restrained" },
  { id: "staggered", labelKey: "CONDITION.Staggered" }
];
