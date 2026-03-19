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

  game.settings.register(MODULE_ID, "autoIntercept", {
    name: "Auto-Intercept Casts",
    hint: "Automatically open the Force Barrage dialog when a Force Barrage spell is cast from chat. Disable if you prefer to use the manual macro only.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}
