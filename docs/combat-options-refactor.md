# Combat options refactor notes

This file documents the current "standard" layout for the combat options code so future work can stay aligned with the refactor that already landed.

## Responsibilities by module
- **`combat-options.js` (entry point)**: Wires Foundry lifecycle hooks one time, then forwards to the more focused modules. No business logic should live here beyond orchestration.
- **`dialog.js`**: Overrides `_prepareContext`, `_defaultFields`, and `computeFields` on the attack dialog prototype to add combat option fields and modifiers. Owns tooltip helpers and dialog-specific calculations.
- **`engagement.js`**: Registers the custom `engaged` condition, listens to token/actor hooks, and recalculates engagement/cover data on canvas or ownership changes. Debounced updates live here, not in the entry point.
- **`measurement.js`**: Normalizes size/cover values, calculates engagement ranges, extracts token radii, and formats tooltips or status labels. Keep this side-effect free so it can be safely imported by other modules.
- **`permissions.js`**: Centralizes GM/ownership checks and any logic that gates whether a client should react to a hook.
- **`turn-effects.js`**: Handles turn-start/turn-end automation such as persistent damage prompts and slowed-condition reminders.
- **`settings.js`**: Defines configuration flags and defaults, keeping user-facing options away from the dialog logic.
- **`logging.js`**: Thin wrapper for debugging output, used when contributors need to trace overrides or hook flow without adding ad hoc `console.log` calls.

## Maintenance guidance
- Avoid reintroducing monolithic helpers; instead, extend the module whose responsibility matches the change. If a feature spans modules, add a small shared helper to `measurement.js` rather than duplicating calculations.
- Keep hook wiring centralized in `combat-options.js` so the rest of the code remains tree-shakeable and testable in isolation.
- New templates or UI fragments should be mounted through `dialog.js` to ensure re-renders stay consistent with Foundry’s lifecycle events.
