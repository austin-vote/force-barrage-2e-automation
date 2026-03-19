import { MODULE_ID } from "./constants.js";
import { log, warn } from "./debug.js";
import { totalShards, heightenSteps, shardFormula } from "./math.js";
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
  const autoBonus = getSpellDamageBonus(actorId);
  const defaultRank = rank ?? 1;
  const hasTargets = targets.length > 0;

  log("openForceBarrageDialog", {
    rank,
    actorId,
    tokenId,
    targetCount: targets.length,
    autoBonus,
  });

  const content = `
    <form class="force-barrage-dialog">
      <div class="form-group">
        <label for="fb-actions">Actions</label>
        <select id="fb-actions" name="actions">
          <option value="1">1</option>
          <option value="2" selected>2</option>
          <option value="3">3</option>
        </select>
      </div>
      <div class="form-group">
        <label for="fb-rank">Rank</label>
        <input id="fb-rank" type="number" name="rank" value="${defaultRank}" min="1" max="10" step="1" />
      </div>
      <div id="fb-shard-summary" style="text-align:center; margin:8px 0;">
        <span id="fb-shard-count" style="font-size:1.4em; font-weight:bold;">—</span>
        <br><span id="fb-shard-detail" class="notes" style="color:#666;">—</span>
      </div>
      <details class="fb-advanced" style="margin-bottom:8px;">
        <summary style="cursor:pointer; font-size:0.9em; color:#666;">Advanced</summary>
        <div class="form-group" style="margin-top:4px;">
          <label for="fb-flat-bonus">Flat Bonus per Target</label>
          <input id="fb-flat-bonus" type="number" name="flatBonus" value="${autoBonus}" min="0" step="1" />
          <p class="notes">Added once per target (e.g. Dangerous Sorcery).</p>
        </div>
      </details>
      <hr />
      ${buildTargetSection(targets, hasTargets)}
      <p id="fb-assign-warning" class="notes" style="color:red; display:none;"></p>
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
          callback: () => {}, // handled by manual click below
        },
      },
      default: "roll",
      render: (html) => {
        attachLiveUpdate(html, hasTargets);
        // Override the Roll button to do validation before close
        html.find('button[data-button="roll"]').off("click").on("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          onSubmit(html, { actorId, tokenId, dlg });
        });
      },
      close: () => log("Force Barrage dialog closed."),
    },
    { width: 380, classes: ["force-barrage", "dialog"] },
  );

  dlg.render(true);
}

/* ---------- target section builder ---------- */

function buildTargetSection(targets, hasTargets) {
  if (!hasTargets) {
    return `
      <p class="notes" style="color:#888; font-style:italic; margin:4px 0;">
        <i class="fas fa-info-circle"></i>
        No targets selected. Damage will not be auto-applied.
      </p>`;
  }

  if (targets.length === 1) {
    const t = targets[0];
    return `
      <div class="form-group fb-target-row"
           data-target-index="0"
           data-target-id="${escapeHtml(String(t.id))}"
           data-actor-uuid="${escapeHtml(t.actorUuid ?? "")}"
           data-token-uuid="${escapeHtml(t.tokenUuid ?? "")}">
        <label style="flex:1;"><i class="fas fa-crosshairs" style="margin-right:4px;"></i>${escapeHtml(t.name)}</label>
        <input type="number" name="shards_0" class="fb-shard-input" value="0" min="0" step="1" style="width:60px;" readonly />
      </div>`;
  }

  // Multi-target
  const rows = targets
    .map(
      (t, i) =>
        `<div class="form-group fb-target-row"
              data-target-index="${i}"
              data-target-id="${escapeHtml(String(t.id))}"
              data-actor-uuid="${escapeHtml(t.actorUuid ?? "")}"
              data-token-uuid="${escapeHtml(t.tokenUuid ?? "")}">
          <label style="flex:1;">${escapeHtml(t.name)}</label>
          <input type="number" name="shards_${i}" class="fb-shard-input" value="0" min="0" step="1" style="width:60px;" />
        </div>`,
    )
    .join("");

  return `
    <p class="notes" style="margin-bottom:4px;">Assign shards to each target.</p>
    ${rows}`;
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

function attachLiveUpdate(html, hasTargets) {
  const actionsEl = html.find('[name="actions"]');
  const rankEl = html.find('[name="rank"]');
  const countEl = html.find("#fb-shard-count");
  const detailEl = html.find("#fb-shard-detail");
  const shardInputs = html.find(".fb-shard-input");
  const isSingleTarget = hasTargets && shardInputs.length === 1;

  function update() {
    const actions = parseInt(actionsEl.val(), 10) || 2;
    const rank = parseInt(rankEl.val(), 10) || 1;
    const shards = totalShards(actions, rank);

    countEl.text(`Total Shards: ${shards}`);
    detailEl.text(`${actions} action${actions !== 1 ? "s" : ""} at rank ${rank}`);

    // Auto-fill single target or no targets
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
  const flatBonus = parseInt(html.find('[name="flatBonus"]').val(), 10) || 0;
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
    const name = row.find("label").text().trim();
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
