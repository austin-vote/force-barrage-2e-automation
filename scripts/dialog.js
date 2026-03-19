import { MODULE_ID } from "./constants.js";
import { log } from "./debug.js";
import { totalShards } from "./math.js";
import { getSpellDamageBonus } from "./hooks.js";
import { rollAndSendDamage } from "./damage.js";

/**
 * Open the Force Barrage dialog.
 *
 * @param {object} opts
 * @param {number|null} opts.rank     - Pre-filled spell rank (null = 1).
 * @param {string|null} opts.actorId  - Casting actor ID (for bonus lookup).
 * @param {string|null} opts.tokenId  - Casting token ID.
 */
export function openForceBarrageDialog({
  rank = null,
  actorId = null,
  tokenId = null,
} = {}) {
  const targets = getSelectedTargets();
  const defaultRank = rank ?? 1;
  const hasTargets = targets.length > 0;
  const rankDetected = rank != null;

  log("openForceBarrageDialog", {
    rank,
    actorId,
    tokenId,
    targetCount: targets.length,
    rankDetected,
  });

  const content = `
    <form class="force-barrage-dialog" autocomplete="off">
      <div style="text-align:center; padding:2px 0 6px;">
        <span id="fb-shard-count" style="font-size:1.8em; font-weight:bold; color:#3d85c6;">—</span>
        <div style="font-size:0.8em; color:#888; margin-top:-2px;">shards</div>
        <div id="fb-bonus-note" style="font-size:0.75em; color:#888; margin-top:2px;"></div>
      </div>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
        <label style="font-size:0.85em;">Actions</label>
        <select name="actions" style="width:55px;">
          <option value="1">1</option>
          <option value="2" selected>2</option>
          <option value="3">3</option>
        </select>
        <label style="font-size:0.85em; margin-left:auto;${rankDetected ? " color:#888;" : ""}">
          ${rankDetected ? '<i class="fas fa-check-circle" style="color:#5a9e5a; margin-right:2px;"></i>' : ""}Rank
        </label>
        <input type="number" name="rank" value="${defaultRank}" min="1" max="10" step="1"
               title="${rankDetected ? `Auto-detected from cast (rank ${defaultRank})` : "Enter spell rank"}"
               style="width:50px; text-align:center;${rankDetected ? " color:#888;" : ""}" />
      </div>
      <hr style="margin:4px 0 8px;" />
      ${buildTargetSection(targets, hasTargets)}
      <p id="fb-assign-warning" class="notes" style="color:#c41e3a; display:none;"></p>
    </form>
  `;

  const dlg = new Dialog(
    {
      title: "Force Barrage",
      content,
      buttons: {
        roll: {
          icon: '<i class="fas fa-dice"></i>',
          label: "Roll",
          callback: () => {},
        },
      },
      default: "roll",
      render: (html) => {
        attachLiveUpdate(html, hasTargets, actorId);
        html.find('button[data-button="roll"]').off("click").on("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          onSubmit(html, { actorId, tokenId, dlg });
        });
      },
      close: () => log("Force Barrage dialog closed."),
    },
    { width: 340, classes: ["force-barrage", "dialog"] },
  );

  dlg.render(true);
}

/* ---------- target section builder ---------- */

function buildTargetSection(targets, hasTargets) {
  if (!hasTargets) {
    return `<p class="notes" style="color:#999; font-size:0.85em; margin:2px 0;">
        No targets — roll will have no apply buttons.</p>`;
  }

  if (targets.length === 1) {
    const t = targets[0];
    return `
      <div class="fb-target-row" style="display:flex; align-items:center; gap:6px; margin:2px 0;"
           data-target-index="0"
           data-target-id="${escapeHtml(String(t.id))}"
           data-actor-uuid="${escapeHtml(t.actorUuid ?? "")}"
           data-token-uuid="${escapeHtml(t.tokenUuid ?? "")}">
        <i class="fas fa-crosshairs" style="color:#888;"></i>
        <span style="flex:1;">${escapeHtml(t.name)}</span>
        <input type="number" name="shards_0" class="fb-shard-input" value="0" min="0" step="1" style="width:50px; text-align:center;" readonly tabindex="-1" />
      </div>`;
  }

  const rows = targets
    .map(
      (t, i) =>
        `<div class="fb-target-row" style="display:flex; align-items:center; gap:6px; margin:1px 0;"
              data-target-index="${i}"
              data-target-id="${escapeHtml(String(t.id))}"
              data-actor-uuid="${escapeHtml(t.actorUuid ?? "")}"
              data-token-uuid="${escapeHtml(t.tokenUuid ?? "")}">
          <span style="flex:1; font-size:0.9em;">${escapeHtml(t.name)}</span>
          <input type="number" name="shards_${i}" class="fb-shard-input" value="0" min="0" step="1" style="width:50px; text-align:center;" />
        </div>`,
    )
    .join("");

  return `<div style="font-size:0.85em; color:#888; margin-bottom:2px;">Assign shards to targets</div>${rows}`;
}

/* ---------- target helpers ---------- */

function getSelectedTargets() {
  const targeted = [...(game.user.targets ?? [])];
  return targeted.map((t) => ({
    id: t.document?.id ?? t.id,
    name: t.name ?? t.document?.name ?? "Unknown",
    actorUuid: t.actor?.uuid ?? null,
    tokenUuid: t.document?.uuid ?? null,
  }));
}

function escapeHtml(str) {
  const el = document.createElement("span");
  el.textContent = str ?? "";
  return el.innerHTML;
}

/* ---------- live update ---------- */

function attachLiveUpdate(html, hasTargets, actorId) {
  const actionsEl = html.find('[name="actions"]');
  const rankEl = html.find('[name="rank"]');
  const countEl = html.find("#fb-shard-count");
  const bonusNoteEl = html.find("#fb-bonus-note");
  const shardInputs = html.find(".fb-shard-input");
  const isSingleTarget = hasTargets && shardInputs.length === 1;

  function update() {
    const actions = parseInt(actionsEl.val(), 10) || 2;
    const rank = parseInt(rankEl.val(), 10) || 1;
    const shards = totalShards(actions, rank);

    countEl.text(shards);

    // Recalculate bonus from actor data whenever rank changes
    const { bonus, sources } = getSpellDamageBonus(actorId, rank);
    if (bonus > 0 && sources.length > 0) {
      const fromPart = sources.length === 1
        ? sources[0].label
        : sources.map((s) => `+${s.value} ${s.label}`).join(", ");
      bonusNoteEl.text(`Including +${bonus} spell damage from ${fromPart}`).show();
    } else {
      bonusNoteEl.text("").hide();
    }

    if (isSingleTarget) {
      shardInputs.eq(0).val(shards);
    }

    if (hasTargets && shardInputs.length > 1) {
      validateAssignment(html, shards);
    }
  }

  actionsEl.on("change", update);
  rankEl.on("change input", update);

  if (shardInputs.length > 1) {
    shardInputs.on("change input", () => {
      const actions = parseInt(actionsEl.val(), 10) || 2;
      const rank = parseInt(rankEl.val(), 10) || 1;
      validateAssignment(html, totalShards(actions, rank));
    });
  }

  update();
}

function validateAssignment(html, expectedShards) {
  const shardInputs = html.find(".fb-shard-input");
  const warningEl = html.find("#fb-assign-warning");
  let used = 0;
  shardInputs.each(function () {
    used += parseInt($(this).val(), 10) || 0;
  });
  if (used !== expectedShards) {
    warningEl
      .text(`Assigned ${used} / ${expectedShards} shards — must match exactly.`)
      .show();
    return false;
  }
  warningEl.hide();
  return true;
}

/* ---------- submit ---------- */

async function onSubmit(html, { actorId, tokenId, dlg }) {
  const actions = parseInt(html.find('[name="actions"]').val(), 10) || 2;
  const rank = parseInt(html.find('[name="rank"]').val(), 10) || 1;
  const { bonus: flatBonus } = getSpellDamageBonus(actorId, rank);
  const shards = totalShards(actions, rank);
  const shardInputs = html.find(".fb-shard-input");

  // Multi-target validation
  if (shardInputs.length > 1) {
    if (!validateAssignment(html, shards)) {
      ui.notifications.error(
        "Force Barrage: Shard assignment does not match total.",
      );
      return;
    }
  }

  // Gather assignments from target rows
  const assignments = [];
  html.find(".fb-target-row").each(function () {
    const row = $(this);
    const targetId = String(row.data("target-id") ?? "");
    const actorUuid = row.data("actor-uuid") || null;
    const tokenUuid = row.data("token-uuid") || null;
    const name = row.find("span").first().text().trim();
    const assigned = parseInt(row.find(".fb-shard-input").val(), 10) || 0;
    if (assigned > 0) {
      assignments.push({ targetId, actorUuid, tokenUuid, name, shards: assigned });
    }
  });

  // No targets selected — roll all shards as a single untargeted group
  if (assignments.length === 0) {
    assignments.push({
      targetId: "untargeted",
      actorUuid: null,
      tokenUuid: null,
      name: "Untargeted",
      shards,
    });
  }

  log("Force Barrage submitted", { actions, rank, flatBonus, shards, assignments });

  dlg.close();

  await rollAndSendDamage({
    actions,
    rank,
    flatBonus,
    shards,
    assignments,
    actorId,
    tokenId,
  });
}

/**
 * Manual / macro entry point.
 */
export function openDialogManual() {
  const token = canvas.tokens?.controlled?.[0] ?? null;
  const actorId = token?.actor?.id ?? null;
  const tokenId = token?.document?.id ?? token?.id ?? null;
  openForceBarrageDialog({ rank: null, actorId, tokenId });
}
