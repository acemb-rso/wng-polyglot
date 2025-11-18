# Wrath & Glory – Combat Extender

Wrath & Glory – Combat Extender is a lightweight [Foundry Virtual Tabletop](https://foundryvtt.com/) module that augments the Wrath & Glory weapon attack dialog with the combat options and situational modifiers from the tabletop rules. The module keeps the experience diegetic by extending the existing dialog, automating common condition bookkeeping, and staying out of the way once play begins.

## Features

- **Extended attack dialog** – Adds toggles for All-Out Attack, Charge, Aim, Brace, Pinning Attacks, Pistols in Melee, Disarm, and Called Shots (with size selector) alongside drop-downs for cover, vision penalties, and target size. Each toggle mirrors the tabletop rules and instantly recalculates dice pools, DN, and damage—including pinning DN derived from the first target’s Resolve.
- **Smart defaults and safety rails** – Reads the first targeted token to pre-fill size and cover (including half/full cover detected from token conditions) and captures target Resolve for pinning. Manual overrides stick until the dialog closes, and when the attacker is Engaged the module enforces ranged restrictions (blocking non-Pistol weapons, suppressing Aim/short-range bonuses, and warning when targets are out of engagement).
- **Automatic Engaged tracking** – The primary GM automatically registers the Engaged condition, watching movement and visibility on the active scene to apply or clear it when friendly and hostile tokens move within the correct reach based on size. Hidden or defeated tokens are ignored so only live threats matter.
- **Turn and condition automation** – All-Out Attack in the dialog syncs the matching condition on the attacker and cleans it up at turn start or when combatants leave combat. At the end of each turn the primary GM is prompted to apply Mortal Wounds for Bleeding or On Fire (including automatic formula rolls), and slowed conditions (Exhausted, Hindered, Restrained, Staggered) trigger whispered reminders.
- **Contested tests** – A built-in macro/API presents an opposed test dialog, letting you pick two actors or tokens, select skills/attributes, grant bonus dice, and resolve both sides simultaneously with Wrath dice. Actor sheets gain a **Contested Roll** header button for quick access.

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

Outside of the dialog the module keeps tabs on combat flow: the primary GM receives prompts for persistent damage, Engaged is applied/cleared automatically as combatants move, and slowed status reminders are whispered when turns begin.

### Debugging manual overrides

If manual values in the weapon dialog appear to be overridden during recalculations, enable the module's debug flag in your browser console to trace the override lifecycle:

```js
game.modules.get("wng-CombatExtender").flags.debug = true;
```

With debugging enabled, the console will log the captured manual override snapshots, when they are re-applied after the system rebuilds the dialog fields, and any changes recorded when you adjust the pool, DN, damage, AP, ED, or Wrath inputs. Disable the flag by setting it back to `false` once you're done.

### Contested tests

The module also exposes a helper for opposed checks. Drag a macro with the following command onto your hotbar to launch the workflow at any time:

```js
game.wngCombatExtender?.contestedRoll();
```

Running the macro presents a dialog where you can pick two actors, select the relevant skills or attributes for each side, and hand out bonus dice for situational modifiers (anything that would normally increase DN). Wrath dice are optional—leave them at zero unless you want the chance of complications. Both tests are resolved simultaneously using Wrath & Glory dice, ties automatically go to the initiating character, and the chat log summarizes icons, shifts, and any Wrath criticals or complications. Actor sheets gain a **Contested Roll** button in their header for quicker access.

## Localization

English strings are bundled with the module. You can add additional translations by mirroring `lang/en.json` and registering the language in `module.json`. Contributions are welcome!

## License

Wrath & Glory is © Games Workshop Limited. This module is an unofficial community project distributed for use with Foundry Virtual Tabletop under its respective licenses.
