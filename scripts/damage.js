import {
  MODULE_ID,
  FORCE_DAMAGE_TYPE,
} from "./constants.js";
import { log, warn } from "./debug.js";
import { shardFormula } from "./math.js";

/**
 * Resolves PF2e's DamageRoll class, falling back to standard Roll.
 * @returns {typeof Roll}
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
 * Roll damage for each target group and post chat cards.
 *
 * @param {object} opts
 * @param {number} opts.actions
 * @param {number} opts.rank
 * @param {number} opts.flatBonus
 * @param {number} opts.shards       - Total shards (for summary).
 * @param {Array}  opts.assignments  - [{ targetId, actorUuid, tokenUuid, name, shards }]
 * @param {boolean} opts.apply       - Whether to auto-apply damage.
 * @param {string|null} opts.actorId
 * @param {string|null} opts.tokenId
 */
export async function rollAndSendDamage({
  actions,
  rank,
  flatBonus,
  shards,
  assignments,
  apply,
  actorId,
  tokenId,
}) {
  const speaker = buildSpeaker(actorId, tokenId);

  // Post a summary card first
  await postSummaryCard({ actions, rank, shards, flatBonus, assignments, speaker });

  // Roll per target
  for (const target of assignments) {
    await rollForTarget({ target, flatBonus, rank, apply, speaker });
  }
}

/**
 * Post a summary-only chat message describing the cast.
 */
async function postSummaryCard({ actions, rank, shards, flatBonus, assignments, speaker }) {
  const distLines = assignments
    .map((a) => {
      const formula = shardFormula(a.shards, flatBonus);
      return `<li><strong>${sanitize(a.name)}</strong>: ${a.shards} shard(s) → ${formula}[${FORCE_DAMAGE_TYPE}]</li>`;
    })
    .join("");

  const content = `
    <div style="border-left: 3px solid #3d85c6; padding-left: 8px; margin-bottom: 4px;">
      <strong style="color: #3d85c6;">Force Barrage</strong><br>
      <span>Rank <strong>${rank}</strong> · ${actions} action(s) · <strong>${shards}</strong> shard(s)</span>
      ${flatBonus ? `<br><span>Flat bonus per target: +${flatBonus}</span>` : ""}
      <ul style="margin:4px 0 0 16px; padding:0;">${distLines}</ul>
    </div>
  `;

  await ChatMessage.create({
    speaker,
    content,
    flags: { [MODULE_ID]: { summary: true } },
  });
}

/**
 * Roll damage for one target group and optionally apply.
 */
async function rollForTarget({ target, flatBonus, rank, apply, speaker }) {
  const formula = shardFormula(target.shards, flatBonus);
  // Wrap in parens so the [force] type tag applies to the entire expression,
  // not just the last term.  PF2e DamageRoll splits on bare + — without
  // parens, "3d4 + 3[force]" would type only the flat 3 as force.
  const typedFormula = `(${formula})[${FORCE_DAMAGE_TYPE}]`;

  try {
    const DamageRoll = getDamageRollClass();
    const roll = new DamageRoll(typedFormula);
    await roll.evaluate();

    const total = Number(roll.total ?? 0);
    if (!Number.isFinite(total) || total < 0) {
      warn("Invalid damage total:", roll.total);
      return;
    }

    const flavor = buildFlavor(target);

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
          target: {
            actor: target.actorUuid ?? null,
            token: target.tokenUuid ?? null,
          },
        },
        [MODULE_ID]: {
          isForceBarrage: true,
          shards: target.shards,
        },
      },
    });

    log(`Rolled ${typedFormula} = ${total} for ${target.name}`);

    if (apply && target.tokenUuid) {
      await maybeApplyDamage(target, total);
    }
  } catch (e) {
    warn("Failed to roll damage for", target.name, e);
  }
}

/**
 * Optionally confirm, then apply damage.  Checks the confirmBeforeApply setting.
 */
async function maybeApplyDamage(target, total) {
  let needsConfirm = false;
  try {
    needsConfirm = game.settings.get(MODULE_ID, "confirmBeforeApply");
  } catch {}

  if (needsConfirm) {
    const confirmed = await new Promise((resolve) => {
      new Dialog({
        title: "Confirm Damage Application",
        content: `<p>Apply <strong>${total}</strong> ${FORCE_DAMAGE_TYPE} damage to <strong>${sanitize(target.name)}</strong>?</p>`,
        buttons: {
          yes: { icon: '<i class="fas fa-check"></i>', label: "Apply", callback: () => resolve(true) },
          no: { icon: '<i class="fas fa-times"></i>', label: "Cancel", callback: () => resolve(false) },
        },
        default: "yes",
        close: () => resolve(false),
      }).render(true);
    });

    if (!confirmed) {
      log(`Damage application cancelled for ${target.name}`);
      return;
    }
  }

  await applyDamage(target, total);
}

/**
 * Apply damage to a token using PF2e's actor.applyDamage API.
 */
async function applyDamage(target, total) {
  try {
    const tokenDoc = target.tokenUuid ? await fromUuid(target.tokenUuid) : null;
    const actor = tokenDoc?.actor ?? (target.actorUuid ? await fromUuid(target.actorUuid) : null);

    if (!actor) {
      warn(`Cannot apply damage: no actor resolved for ${target.name}`);
      return;
    }

    // PF2e actors expose applyDamage() for IWR-aware HP reduction
    if (typeof actor.applyDamage === "function") {
      await actor.applyDamage({
        damage: total,
        token: tokenDoc ?? undefined,
        type: FORCE_DAMAGE_TYPE,
      });
      log(`Applied ${total} ${FORCE_DAMAGE_TYPE} damage to ${target.name} via applyDamage`);
    } else {
      // Fallback: direct HP adjustment (no IWR processing)
      const hp = actor.system?.attributes?.hp;
      if (hp && typeof hp.value === "number") {
        const newHp = Math.max(0, hp.value - total);
        await actor.update({ "system.attributes.hp.value": newHp });
        log(`Fallback HP update: ${target.name} ${hp.value} → ${newHp}`);
      } else {
        warn(`Cannot apply damage to ${target.name}: no applyDamage method and no HP attribute found.`);
      }
    }
  } catch (e) {
    warn("applyDamage error:", e);
  }
}

/* ---------- helpers ---------- */

function buildFlavor(target) {
  return [
    `<div style="border-left: 3px solid #3d85c6; padding-left: 8px; margin-bottom: 4px;">`,
    `  <strong style="color: #3d85c6;">Force Barrage</strong><br>`,
    `  <span>${target.shards} shard(s) → <strong>${sanitize(target.name)}</strong></span>`,
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

/** HTML-entity escaping to prevent XSS from token/actor names. */
function sanitize(str) {
  const el = document.createElement("span");
  el.textContent = str ?? "";
  return el.innerHTML;
}
