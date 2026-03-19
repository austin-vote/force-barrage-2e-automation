/**
 * Force Barrage — Foundry VTT Macro
 *
 * Paste the contents of this file into a Script macro in Foundry.
 * Assign it a hotkey or toolbar slot for quick access during play.
 *
 * Requirements:
 *   - The "Force Barrage Automation" module must be active.
 *   - Works after a plain Foundry page refresh (no build step required).
 *
 * Usage:
 *   1. Select (control) your caster's token on the canvas.
 *   2. Target enemy tokens via the targeting tool (T key by default).
 *   3. Run this macro.
 *   4. The dialog opens with the caster pre-filled and current targets loaded.
 *
 * If targets are selected, Roll & Apply will be available.
 * If no targets are selected, only Roll Only is available (safe default).
 */

const mod = game.modules.get("force-barrage");

if (!mod?.active) {
  ui.notifications.error(
    "Force Barrage module is not active. Enable it in Settings → Manage Modules.",
  );
} else if (typeof mod.api?.openDialog !== "function") {
  ui.notifications.error(
    "Force Barrage API not found — try reloading Foundry (F5). " +
      "If the problem persists, check the browser console for errors.",
  );
} else {
  mod.api.openDialog();
}
