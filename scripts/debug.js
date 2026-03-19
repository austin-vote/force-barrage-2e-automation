import { MODULE_ID } from "./constants.js";

const PREFIX = `[${MODULE_ID}]`;
const STYLE = "color: #3d85c6; font-weight: bold;";

let debugEnabled = false;

/** Read the debug-logging setting. Called on ready and on setting change. */
export function initDebug() {
  try {
    debugEnabled = game.settings.get(MODULE_ID, "debugLogging");
  } catch {
    debugEnabled = false;
  }
}

export { initDebug as refreshDebug };

/** Conditional debug log (only when the setting is on). */
export function log(...args) {
  if (debugEnabled) {
    console.log(`%c${PREFIX}`, STYLE, ...args);
  }
}

/** Always-on warning log. */
export function warn(...args) {
  console.warn(PREFIX, ...args);
}
