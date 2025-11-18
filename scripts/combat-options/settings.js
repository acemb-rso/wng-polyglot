import { MODULE_ID } from "./constants.js";

export const registerSettings = () => {
  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "debugLogging", {
      name: "Enable debug logging",
      hint: "Toggle verbose console logging for WNG Combat Extender.",
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
      restricted: true
    });
  });
};
