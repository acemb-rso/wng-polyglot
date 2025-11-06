# Wrath & Glory – Combat Extender

Wrath & Glory – Combat Extender is a lightweight [Foundry Virtual Tabletop](https://foundryvtt.com/) module that augments the Wrath & Glory weapon attack dialog with the combat options and situational modifiers from the tabletop rules. The module integrates the extra controls directly into the existing dialog so players can apply bonuses and penalties without manual arithmetic or house-rule macros.

## Features

- **Enhanced attack dialog** – Adds toggles for All-Out Attack, Charge, Grapple, Fall Back, Aim, Brace, Pinning Attacks, Pistols in Melee, Disarm, and Called Shot (with size selector) alongside drop-downs for cover, vision penalties, and target size. The options mirror the printed rules and automatically recalculate dice pools, DN, and damage whenever they change.【F:scripts/combat-options.js†L227-L296】【F:templates/combat-options.hbs†L1-L81】
- **Context-aware defaults** – Reads the first targeted token to pre-fill the target size and cover selectors, including Half/Full cover detection from token conditions, and honours manual overrides until the dialog closes.【F:scripts/combat-options.js†L140-L158】【F:scripts/combat-options.js†L903-L971】
- **All-Out Attack condition sync** – When All-Out Attack is toggled the module applies or removes the system condition on the attacking actor, ensuring Defences update correctly between turns and clearing the effect when combat ends.【F:scripts/combat-options.js†L74-L135】【F:scripts/combat-options.js†L513-L548】【F:scripts/combat-options.js†L635-L672】
- **Persistent damage automation** – At the end of a combatant’s turn the primary GM is prompted to apply Mortal Wounds for persistent damage sources such as Bleeding or On Fire, with automatic roll evaluation for formula-based effects and chat card output.【F:scripts/combat-options.js†L167-L377】
- **Slowed condition reminders** – Notifies the table when a combatant starting their turn is Exhausted, Hindered, Restrained, or Staggered so the GM can apply the appropriate penalties.【F:scripts/combat-options.js†L379-L510】

## Requirements

- Foundry VTT v12 or v13 (tested against v13).【F:module.json†L14-L17】
- Wrath & Glory system v6 or later.【F:module.json†L32-L38】
- [`lib-wrapper`](https://github.com/ruipin/fvtt-lib-wrapper) v1.12.0 or newer.【F:module.json†L39-L46】

## Installation

1. Open **Configuration & Setup → Add-on Modules → Install Module** in Foundry VTT.
2. Paste the manifest URL: `https://raw.githubusercontent.com/acemb-rso/wng-CombatExtender/main/module.json`
3. Click **Install**.
4. Enable *Wrath & Glory – Combat Extender* in your World **Manage Modules** screen.

The GitHub repository also provides a ZIP download if you prefer manual installation.【F:module.json†L25-L31】

## Usage

1. Target an enemy token and trigger any weapon roll (melee or ranged).
2. Expand the **Combat Options** panel in the attack dialog.
3. Toggle the relevant options – the module recalculates dice pools, DN, damage, and extra damage dice immediately and refreshes the visible inputs.【F:templates/combat-options.hbs†L1-L87】【F:scripts/combat-options.js†L688-L868】
4. Options with prerequisites (e.g. Pinning Attacks requiring Salvo 2+) enable or disable themselves automatically as your weapon configuration changes.【F:scripts/combat-options.js†L226-L268】【F:scripts/combat-options.js†L790-L840】

During combat the module keeps track of persistent damage and slowed conditions. When a combatant’s turn ends, a dialog prompts the GM to apply the calculated Mortal Wounds, including die rolls for configurable formulas; reminders for slowed statuses are whispered to GMs and posted to chat depending on party settings.【F:scripts/combat-options.js†L167-L377】【F:scripts/combat-options.js†L379-L510】

## Localization

English strings are bundled with the module. You can add additional translations by mirroring `lang/en.json` and registering the language in `module.json`. Contributions are welcome!【F:lang/en.json†L1-L16】【F:module.json†L18-L21】

## License

Wrath & Glory is © Games Workshop Limited. This module is an unofficial community project distributed for use with Foundry Virtual Tabletop under its respective licenses.
