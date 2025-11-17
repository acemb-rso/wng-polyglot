# Combat options refactor notes

This file summarizes the current API surface inside `scripts/combat-options.js` and proposes a safe split into smaller modules.

## Current responsibilities
- **Dialog extension**: Overrides `_prepareContext`, `_defaultFields`, and `computeFields` on the attack dialog prototype to add combat option fields and modifiers.
- **UI wiring**: Renders the `combat-options.hbs` fragment into the attack dialog, manages change handlers, and keeps values in sync when Foundry recomputes fields.
- **Engagement and condition tracking**: Registers the custom `engaged` condition, listens to token/actor hooks, and recalculates engagement/cover data on canvas or ownership changes.
- **Measurement/helpers**: Normalizes size/cover values, calculates engagement ranges, extracts token radii, and formats tooltips or status labels.

## Suggested module boundaries
- **`dialog-extension.js`**: Patch the attack dialog prototype (context, default fields, compute hooks) plus tooltip helpers. Accept a small facade of helper functions (size/cover lookups, vision data) injected via imports to keep it pure.
- **`ui-renderer.js`**: Handle `renderDialog`/`renderAttack` hooks, template rendering, and change listeners. Expose a function like `mountCombatOptions(app, html)` so the entry point can call it after dialog renders.
- **`engagement-service.js`**: Track engagement/cover/size state across tokens. Owns hook registrations, debounce logic, and helpers such as `requestEngagedEvaluation`, `handleTokenChange`, and `handleActorUpdate`.
- **`combat-math.js`**: Shared utilities for size normalization, cover modifiers, vision penalties, and persistent-damage evaluation. These are already side-effect free and can be imported by both dialog and engagement modules.

## Minimal entry point
Create a slim `combat-options.js` entry that imports the modules above, registers hooks once, and forwards Foundry events to the appropriate module functions. The existing API surface (Foundry hooks, dialog prototype methods, and template rendering) is already self-contained, so extracting code into modules should not require new engine APIs—just shared exports and a predictable initialization order.
