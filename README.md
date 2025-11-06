# Wrath & Glory – Combat Extender

Wrath & Glory – Combat Extender is a lightweight [Foundry Virtual Tabletop](https://foundryvtt.com/) module that augments the Wrath & Glory weapon attack dialog with the combat options and situational modifiers from the tabletop rules. The module integrates the extra controls directly into the existing dialog so players can apply bonuses and penalties without manual arithmetic or house-rule macros.

## Features

- **Enhanced attack dialog** – Adds toggles for All-Out Attack, Charge, Grapple, Fall Back, Aim, Brace, Pinning Attacks, Pistols in Melee, Disarm, and Called Shot (with size selector) alongside drop-downs for cover, vision penalties, and target size. The options mirror the printed rules and automatically recalculate dice pools, DN, and damage whenever they change.
- **Context-aware defaults** – Reads the first targeted token to pre-fill the target size and cover selectors, including Half/Full cover detection from token conditions, and honours manual overrides until the dialog closes.
- **All-Out Attack condition sync** – When All-Out Attack is toggled the module applies or removes the system condition on the attacking actor, ensuring Defences update correctly between turns and clearing the effect when combat ends.
- **Persistent damage automation** – At the end of a combatant’s turn the primary GM is prompted to apply Mortal Wounds for persistent damage sources such as Bleeding or On Fire, with automatic roll evaluation for formula-based effects and chat card output.
- **Slowed condition reminders** – Notifies the table when a combatant starting their turn is Exhausted, Hindered, Restrained, or Staggered so the GM can apply the appropriate penalties.

## Requirements

- Foundry VTT v12 or v13 (tested against v13).
- Wrath & Glory system v6 or later.
- [`lib-wrapper`](https://github.com/ruipin/fvtt-lib-wrapper) v1.12.0 or newer.

## Installation

1. Open **Configuration & Setup → Add-on Modules → Install Module** in Foundry VTT.
2. Paste the manifest URL: `https://raw.githubusercontent.com/acemb-rso/wng-CombatExtender/main/module.json`
3. Click **Install**.
4. Enable *Wrath & Glory – Combat Extender* in your World **Manage Modules** screen.

The GitHub repository also provides a ZIP download if you prefer manual installation.

## Usage

1. Target an enemy token and trigger any weapon roll (melee or ranged).
2. Expand the **Combat Options** panel in the attack dialog.
3. Toggle the relevant options – the module recalculates dice pools, DN, damage, and extra damage dice immediately and refreshes the visible inputs.
4. Options with prerequisites (e.g. Pinning Attacks requiring Salvo 2+) enable or disable themselves automatically as your weapon configuration changes.

During combat the module keeps track of persistent damage and slowed conditions. When a combatant’s turn ends, a dialog prompts the GM to apply the calculated Mortal Wounds, including die rolls for configurable formulas; reminders for slowed statuses are whispered to GMs and posted to chat depending on party settings.

## Localization

English strings are bundled with the module. You can add additional translations by mirroring `lang/en.json` and registering the language in `module.json`. Contributions are welcome!

## License

Wrath & Glory is © Games Workshop Limited. This module is an unofficial community project distributed for use with Foundry Virtual Tabletop under its respective licenses.
