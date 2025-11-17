import { MODULE_LABEL } from "./constants.js";

export const log = (level, message, ...data) => {
  const logger = console[level] ?? console.log;
  logger(`${MODULE_LABEL} | ${message}`, ...data);
};

export const logError = (...args) => log("error", ...args);
