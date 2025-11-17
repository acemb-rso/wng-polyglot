import { registerEngagementAutomation } from "./combat-options/engagement.js";
import { registerTurnEffectHooks } from "./combat-options/turn-effects.js";
import "./combat-options/dialog.js";

registerEngagementAutomation();
registerTurnEffectHooks();
