import { MODULE_ID, MODULE_LABEL } from "./constants.js";

export const log = (level, message, ...data) => {
  const logger = console[level] ?? console.log;
  logger(`${MODULE_LABEL} | ${message}`, ...data);
};

export const logError = (...args) => log("error", ...args);

export const isDebugEnabled = () => {
  const settingsDebug = game?.settings?.get?.(MODULE_ID, "debugLogging");
  if (typeof settingsDebug === "boolean") return settingsDebug;

  return Boolean(game?.modules?.get?.(MODULE_ID)?.flags?.debug);
};

export const logDebug = (...args) => {
  if (!isDebugEnabled()) return;
  log("debug", ...args);
};
