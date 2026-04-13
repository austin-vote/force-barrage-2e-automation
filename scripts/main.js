import { MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { initDebug, log } from "./debug.js";
import { detectForceBarrage } from "./hooks.js";
import { openForceBarrageDialog, openDialogManual } from "./dialog.js";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Force Barrage automation.`);
  registerSettings();
});

Hooks.once("ready", () => {
  initDebug();
  log("Module ready.");

  // --- Auto-intercept spell casts ---
  Hooks.on("createChatMessage", (message) => {
    // In Foundry v13, message.author is a User document; older versions use message.user.
    // Only intercept for the GM or the user who created the message.
    const authorId = message.author?.id ?? message.user?.id ?? message.userId;
    if (!game.user.isGM && game.user.id !== authorId) return;

    // Skip messages this module created
    if (message.flags?.[MODULE_ID]) return;

    const result = detectForceBarrage(message);
    if (!result.detected) return;

    log("Force Barrage cast detected in chat", result);
    openForceBarrageDialog({
      rank: result.rank,
      actorId: result.actorId,
      tokenId: result.tokenId,
    });
  });

  // --- Expose public API for macros / item actions ---
  const moduleObj = game.modules.get(MODULE_ID);
  if (moduleObj) {
    moduleObj.api = {
      openDialog: openDialogManual,
      openForceBarrageDialog,
    };
    log("Public API registered on game.modules.get('force-barrage').api");
  }

  log("Hooks registered. Force Barrage is active.");
});
