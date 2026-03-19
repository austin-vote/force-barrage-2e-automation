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

  game.settings.register(MODULE_ID, "spellSlugs", {
    name: "Spell Slug Overrides",
    hint: "Comma-separated item slugs to match Force Barrage casts. Leave blank to use built-in defaults.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, "confirmBeforeApply", {
    name: "Confirm Before Applying Damage",
    hint: "When using Roll & Apply, show a confirmation dialog before modifying target HP.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
}
