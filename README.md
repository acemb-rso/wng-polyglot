# Wrath & Glory – Combat Extender

Wrath & Glory – Combat Extender is a lightweight [Foundry Virtual Tabletop](https://foundryvtt.com/) module that augments the Wrath & Glory weapon attack dialog with the combat options and situational modifiers from the tabletop rules. The module keeps the experience diegetic by extending the existing dialog, automating common condition bookkeeping, and staying out of the way once play begins.

## Features

- **Enhanced attack dialog** – Adds toggles for All-Out Attack, Charge, Grapple, Fall Back, Aim, Brace, Pinning Attacks, Pistols in Melee, Disarm, and Called Shot (with size selector) alongside drop-downs for cover, vision penalties, and target size. The options mirror the printed rules and automatically recalculate dice pools, DN, and damage whenever they change.
- **Context-aware defaults** – Reads the first targeted token to pre-fill the target size and cover selectors (including Half/Full cover detection from token conditions). Manual overrides stick until the dialog closes so players stay in control.
- **All-Out Attack automation** – Toggling All-Out Attack applies or clears the matching Wrath & Glory condition on the attacking actor. The effect is removed automatically at the start of the combatant’s next turn or when combat ends to keep Defences consistent.
- **Automatic Engaged tracking** – The primary GM has engaged status handled automatically. The module registers the Engaged condition, watches token movement on the active scene, and applies/removes the condition when friendly and hostile tokens come within the correct reach (respecting token size and defeat/hidden states). It gracefully falls back if the system’s aura helpers are unavailable.
- **Persistent damage helpers** – At the end of a combatant’s turn the primary GM is prompted to apply Mortal Wounds for persistent damage sources such as Bleeding or On Fire, with automatic roll evaluation for formula-based effects and chat card output.
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
