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
 * @param {number} opts.flatBonus     - Global flat bonus fallback; overridden by target.flatBonus if set.
 * @param {number} opts.totalShards   - Grand total shards across all targets (flavor text only).
 * @param {Array}  opts.assignments   - [{ targetId, actorUuid, tokenUuid, name, shards, flatBonus? }]
 * @param {string|null} opts.actorId
 * @param {string|null} opts.tokenId
 */
export async function rollAndSendDamage({
  actions,
  rank,
  flatBonus,
  totalShards,
  assignments,
  actorId,
  tokenId,
}) {
  const speaker = buildSpeaker(actorId, tokenId);

  for (const target of assignments) {
    await rollForTarget({ target, flatBonus, actions, rank, totalShards, speaker, totalAssignments: assignments.length });
  }
}

/**
 * Roll damage for one target group and post a chat card.
 * Includes pf2e.target flags when tokenUuid is available, enabling PF2e's apply-damage buttons.
 */
async function rollForTarget({ target, flatBonus, actions, rank, totalShards, speaker, totalAssignments }) {
  const bonus = target.flatBonus ?? flatBonus ?? 0;
  const formula = shardFormula(target.shards, bonus);
  const typedFormula = `(${formula})[${FORCE_DAMAGE_TYPE}]`;

  log(`rollForTarget: target=${target.name} shards=${target.shards} bonus=${bonus} formula=${typedFormula}`)

  try {
    const DamageRoll = getDamageRollClass();
    const roll = new DamageRoll(typedFormula);
    // { async: true } is required in Foundry v10+ — synchronous evaluation
    // can silently fail for DamageRoll and other complex roll types.
    await roll.evaluate({ async: true });

    const total = Number(roll.total ?? 0);
    if (!Number.isFinite(total) || total < 0) {
      warn("Invalid damage total:", roll.total);
      return;
    }

    const flavor = buildFlavor({ target, actions, rank, totalShards, totalAssignments });

    // pf2e.target is required for PF2e's native apply-damage buttons; omitted when
    // tokenUuid is absent (actor-only targets will not show apply buttons).
    const pf2eTarget = target.tokenUuid
      ? { actor: target.actorUuid ?? null, token: target.tokenUuid }
      : undefined;

    await roll.toMessage({
      speaker,
      flavor,
      flags: {
        pf2e: {
          // context.options omitted: "item:force-barrage" is not a recognized
          // PF2e roll option and does not affect weakness/resistance checks.
          context: {
            type: "damage-roll",
            sourceType: "spell",
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

function buildFlavor({ target, actions, rank, totalShards, totalAssignments }) {
  const targetLine =
    target.targetId === "untargeted"
      ? ""
      : `<br><span>${target.shards} shard${target.shards !== 1 ? "s" : ""} → <strong>${sanitize(target.name)}</strong></span>`;

  return [
    `<div style="border-left: 3px solid #3d85c6; padding-left: 8px; margin-bottom: 4px;">`,
    `  <strong style="color: #3d85c6;">Force Barrage</strong>`,
    `  <span class="notes" style="color:#888;"> — Rank ${rank}, ${actions} action${actions !== 1 ? "s" : ""}${totalAssignments > 1 ? `, ${totalShards} total shards` : ""}</span>`,
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
