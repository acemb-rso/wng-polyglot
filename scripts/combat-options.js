import { registerEngagementAutomation } from "./combat-options/engagement.js";
import { registerSettings } from "./combat-options/settings.js";
import { registerTurnEffectHooks } from "./combat-options/turn-effects.js";
import "./combat-options/dialog.js";

registerSettings();
registerEngagementAutomation();
registerTurnEffectHooks();
