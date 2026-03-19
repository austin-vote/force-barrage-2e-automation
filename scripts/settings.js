import { MODULE_ID } from "./constants.js";
import { refreshDebug } from "./debug.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, "debugLogging", {
    name: "Debug Logging",
    hint: "Enable verbose console logging for troubleshooting. Check the browser console (F12).",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => refreshDebug(),
  });

}
