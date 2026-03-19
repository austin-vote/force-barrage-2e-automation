import { MODULE_ID, FORCE_DAMAGE_TYPE } from "./constants.js";
import { log, warn } from "./debug.js";
import { shardFormula } from "./math.js";

/**
 * Resolves PF2e's DamageRoll class, falling back to standard Roll.
 */
function getDamageRollClass() {
  const cls =
    CONFIG.PF2E?.Dice?.DamageRoll ??
    game.pf2e?.DamageRoll ??
    CONFIG.Dice?.rolls?.find((R) => R.name === "DamageRoll") ??
    null;

  if (!cls) {
    warn("PF2e DamageRoll not found — falling back to standard Roll.");
    return Roll;
  }
  return cls;
}

/**
 * Roll damage for each target and post chat cards.
 * This module NEVER applies damage directly — only PF2e's native chat
 * apply-damage buttons are used (via pf2e.target flags).
 *
 * @param {object} opts
 * @param {number} opts.actions
 * @param {number} opts.rank
 * @param {number} opts.flatBonus
 * @param {number} opts.shards       - Total shards (for summary).
 * @param {Array}  opts.assignments  - [{ targetId, actorUuid, tokenUuid, name, shards }]
 * @param {string|null} opts.actorId
 * @param {string|null} opts.tokenId
 */
export async function rollAndSendDamage({
  actions,
  rank,
  flatBonus,
  shards,
  assignments,
  actorId,
  tokenId,
}) {
  const speaker = buildSpeaker(actorId, tokenId);

  for (const target of assignments) {
    await rollForTarget({ target, flatBonus, actions, rank, shards, speaker, totalAssignments: assignments.length });
  }
}

/**
 * Roll damage for one target group and post a chat card.
 * Always includes pf2e.target when a tokenUuid is available so PF2e
 * renders its native Apply Damage buttons.
 */
async function rollForTarget({ target, flatBonus, actions, rank, shards, speaker, totalAssignments }) {
  const formula = shardFormula(target.shards, flatBonus);
  const typedFormula = `(${formula})[${FORCE_DAMAGE_TYPE}]`;

  log(`rollForTarget: ${target.name} — ${target.shards} shard(s), flatBonus=${flatBonus}, formula=${typedFormula}`);

  try {
    const DamageRoll = getDamageRollClass();
    const roll = new DamageRoll(typedFormula);
    await roll.evaluate();

    const total = Number(roll.total ?? 0);
    if (!Number.isFinite(total) || total < 0) {
      warn("Invalid damage total:", roll.total);
      return;
    }

    const flavor = buildFlavor({ target, actions, rank, shards, totalAssignments });

    // Always include pf2e.target when we have a token — this makes PF2e
    // render its native apply-damage buttons on the chat card.
    const pf2eTarget = target.tokenUuid
      ? { actor: target.actorUuid ?? null, token: target.tokenUuid }
      : undefined;

    await roll.toMessage({
      speaker,
      flavor,
      flags: {
        pf2e: {
          context: {
            type: "damage-roll",
            sourceType: "spell",
            options: ["item:force-barrage"],
          },
          ...(pf2eTarget ? { target: pf2eTarget } : {}),
        },
        [MODULE_ID]: {
          isForceBarrage: true,
          shards: target.shards,
        },
      },
    });

    log(`Rolled ${typedFormula} = ${total} for ${target.name}`);
  } catch (e) {
    warn("Failed to roll damage for", target.name, e);
  }
}

/* ---------- helpers ---------- */

function buildFlavor({ target, actions, rank, shards, totalAssignments }) {
  const targetLine =
    target.targetId === "untargeted"
      ? ""
      : `<br><span>${target.shards} shard${target.shards !== 1 ? "s" : ""} → <strong>${sanitize(target.name)}</strong></span>`;

  return [
    `<div style="border-left: 3px solid #3d85c6; padding-left: 8px; margin-bottom: 4px;">`,
    `  <strong style="color: #3d85c6;">Force Barrage</strong>`,
    `  <span class="notes" style="color:#888;"> — Rank ${rank}, ${actions} action${actions !== 1 ? "s" : ""}${totalAssignments > 1 ? `, ${shards} total shards` : ""}</span>`,
    `  ${targetLine}`,
    `</div>`,
  ].join("\n");
}

function buildSpeaker(actorId, tokenId) {
  if (tokenId || actorId) {
    return ChatMessage.getSpeaker({
      scene: canvas.scene?.id,
      actor: actorId,
      token: tokenId,
    });
  }
  return ChatMessage.getSpeaker();
}

function sanitize(str) {
  const el = document.createElement("span");
  el.textContent = str ?? "";
  return el.innerHTML;
}
