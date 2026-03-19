import { MODULE_ID } from "./constants.js";
import { log, warn } from "./debug.js";
import { totalShards, heightenSteps, shardFormula } from "./math.js";
import { getSpellDamageBonus } from "./hooks.js";
import { rollAndSendDamage } from "./damage.js";

/**
 * Open the Force Barrage dialog.
 *
 * Uses manual button handlers instead of Dialog button callbacks so that
 * validation errors can prevent the dialog from closing.
 *
 * @param {object} opts
 * @param {number|null} opts.rank     - Pre-filled spell rank (null = ask).
 * @param {string|null} opts.actorId  - Casting actor ID (for bonus lookup).
 * @param {string|null} opts.tokenId  - Casting token ID.
 */
export function openForceBarrageDialog({ rank = null, actorId = null, tokenId = null } = {}) {
  const targets = getSelectedTargets();
  const autoBonus = getSpellDamageBonus(actorId);
  const defaultRank = rank ?? 1;

  log("openForceBarrageDialog", { rank, actorId, tokenId, targetCount: targets.length, autoBonus });

  const targetRows = buildTargetInputRows(targets);
  const isUntargeted = targets.length === 1 && targets[0].untargeted === true;

  const content = `
    <form class="force-barrage-dialog">
      <div class="form-group">
        <label for="fb-actions">Actions Spent</label>
        <select id="fb-actions" name="actions">
          <option value="1">1 Action</option>
          <option value="2" selected>2 Actions</option>
          <option value="3">3 Actions</option>
        </select>
      </div>
      <div class="form-group">
        <label for="fb-rank">Spell Rank</label>
        <input id="fb-rank" type="number" name="rank" value="${defaultRank}" min="1" max="10" step="1" />
      </div>
      <div class="form-group">
        <label for="fb-flat-bonus">Flat Bonus per Target</label>
        <input id="fb-flat-bonus" type="number" name="flatBonus" value="${autoBonus}" min="0" step="1" />
        <p class="notes">Per-target flat bonus added once to each target's combined damage (e.g., Dangerous Sorcery).</p>
      </div>
      <hr />
      <div class="form-group">
        <label>Shard Summary</label>
        <p id="fb-shard-summary" class="notes" style="font-weight:bold;">—</p>
      </div>
      <hr />
      <h3>Target Assignment</h3>
      ${isUntargeted
        ? `<p class="notification warning" style="margin:4px 0 8px; padding:4px 8px;">
             <i class="fas fa-exclamation-triangle"></i>
             No tokens targeted — <strong>Roll &amp; Apply is disabled</strong>.<br/>
             Target tokens before opening this dialog, or use Roll Only.
           </p>`
        : `<p class="notes">Assign shards to each target. Total must equal calculated shards.</p>`
      }
      <div id="fb-target-rows">
        ${targetRows}
      </div>
      <p id="fb-assign-warning" class="notes" style="color:red; display:none;"></p>
      <hr />
      <div style="display:flex; gap:8px; justify-content:flex-end; padding-top:4px;">
        <button type="button" id="fb-btn-roll"><i class="fas fa-dice"></i> Roll Only</button>
        <button type="button" id="fb-btn-apply"><i class="fas fa-crosshairs"></i> Roll &amp; Apply</button>
      </div>
    </form>
  `;

  // Use a Dialog with no built-in buttons; buttons are in the HTML body
  // so we can prevent close on validation failure.
  const dlg = new Dialog(
    {
      title: "Force Barrage",
      content,
      buttons: {},
      render: (html) => {
        attachLiveUpdate(html);
        html.find("#fb-btn-roll").on("click", () => onSubmit(html, { apply: false, actorId, tokenId, dlg }));
        html.find("#fb-btn-apply").on("click", () => onSubmit(html, { apply: true, actorId, tokenId, dlg }));
        if (isUntargeted) {
          html.find("#fb-btn-apply")
            .prop("disabled", true)
            .attr("title", "Target at least one token to enable Roll & Apply");
        }
      },
      close: () => log("Force Barrage dialog closed."),
    },
    { width: 440, classes: ["force-barrage", "dialog"] },
  );

  dlg.render(true);
}

/* ---------- target helpers ---------- */

function getSelectedTargets() {
  const targeted = [...(game.user.targets ?? [])];
  if (targeted.length > 0) {
    return targeted.map((t) => ({
      id: t.document?.id ?? t.id,
      name: t.name ?? t.document?.name ?? "Unknown",
      actorUuid: t.actor?.uuid ?? null,
      tokenUuid: t.document?.uuid ?? null,
      untargeted: false,
    }));
  }
  // No tokens targeted — Roll & Apply will be blocked to prevent unintended HP changes.
  return [{ id: "untargeted", name: "Untargeted Roll", actorUuid: null, tokenUuid: null, untargeted: true }];
}

/** Minimal HTML entity escaping for target names rendered inside the dialog. */
function escapeHtml(str) {
  const el = document.createElement("span");
  el.textContent = str ?? "";
  return el.innerHTML;
}

function buildTargetInputRows(targets) {
  return targets
    .map((t, i) => {
      const isUntargeted = t.untargeted === true;
      const inputAttrs = isUntargeted
        ? `readonly style="width:60px; background:#eee; cursor:not-allowed;"`
        : `style="width:60px;"`;
      return `<div class="form-group fb-target-row" data-target-index="${i}" data-target-id="${escapeHtml(String(t.id))}" data-actor-uuid="${escapeHtml(t.actorUuid ?? "")}" data-token-uuid="${escapeHtml(t.tokenUuid ?? "")}" data-untargeted="${isUntargeted}">
          <label>${escapeHtml(t.name)}</label>
          <input type="number" name="shards_${i}" class="fb-shard-input" value="0" min="0" step="1" ${inputAttrs} />
        </div>`;
    })
    .join("");
}

/* ---------- live update ---------- */

function attachLiveUpdate(html) {
  const actionsEl = html.find('[name="actions"]');
  const rankEl = html.find('[name="rank"]');
  const summaryEl = html.find("#fb-shard-summary");
  const shardInputs = html.find(".fb-shard-input");

  function update() {
    const actions = parseInt(actionsEl.val(), 10) || 2;
    const rank = parseInt(rankEl.val(), 10) || 1;
    const steps = heightenSteps(rank);
    const shards = totalShards(actions, rank);
    summaryEl.text(`${shards} shard(s)  \u2014  ${actions} action(s) \u00d7 (1 + ${steps} heighten step${steps !== 1 ? "s" : ""}) = ${shards}`);

    // Auto-fill when there is only one target row
    if (shardInputs.length === 1) {
      shardInputs.eq(0).val(shards);
    }

    validateAssignment(html, shards);
  }

  actionsEl.on("change", update);
  rankEl.on("change input", update);
  shardInputs.on("change input", () => {
    const actions = parseInt(actionsEl.val(), 10) || 2;
    const rank = parseInt(rankEl.val(), 10) || 1;
    validateAssignment(html, totalShards(actions, rank));
  });

  update();
}

/**
 * @returns {boolean} true if shard assignments match expected total
 */
function validateAssignment(html, expectedShards) {
  const shardInputs = html.find(".fb-shard-input");
  const warningEl = html.find("#fb-assign-warning");
  let used = 0;
  shardInputs.each(function () {
    used += parseInt($(this).val(), 10) || 0;
  });
  if (used !== expectedShards) {
    warningEl.text(`Assigned ${used} / ${expectedShards} shards \u2014 must match exactly.`).show();
    return false;
  }
  warningEl.hide();
  return true;
}

/* ---------- submit ---------- */

async function onSubmit(html, { apply, actorId, tokenId, dlg }) {
  const actions = parseInt(html.find('[name="actions"]').val(), 10) || 2;
  const rank = parseInt(html.find('[name="rank"]').val(), 10) || 1;
  const flatBonus = parseInt(html.find('[name="flatBonus"]').val(), 10) || 0;
  const shards = totalShards(actions, rank);

  // Safety: if Roll & Apply was somehow invoked with no real targets (e.g. a
  // macro bypassing the disabled button), silently fall back to Roll Only so
  // HP is never mutated without a resolved token.
  const hasRealTargets = html.find(".fb-target-row[data-untargeted='true']").length === 0;
  const shouldApply = apply && hasRealTargets;
  if (apply && !hasRealTargets) {
    warn("Force Barrage: Roll & Apply requested with no targets — rolling without applying.");
  }

  // Validate before closing — dialog stays open on failure
  if (!validateAssignment(html, shards)) {
    ui.notifications.error("Force Barrage: Shard assignment does not match total. Fix it and try again.");
    return;
  }

  // Gather per-target assignments
  const assignments = [];
  html.find(".fb-target-row").each(function () {
    const row = $(this);
    const targetId = String(row.data("target-id") ?? "");
    const actorUuid = row.data("actor-uuid") || null;
    const tokenUuid = row.data("token-uuid") || null;
    const name = row.find("label").text();
    const assigned = parseInt(row.find(".fb-shard-input").val(), 10) || 0;
    if (assigned > 0) {
      assignments.push({ targetId, actorUuid, tokenUuid, name, shards: assigned });
    }
  });

  if (assignments.length === 0) {
    ui.notifications.warn("Force Barrage: No shards assigned to any target.");
    return;
  }

  log("Force Barrage submitted", { actions, rank, flatBonus, shards, assignments, apply: shouldApply });

  // Close dialog only after validation passes
  dlg.close();

  await rollAndSendDamage({
    actions,
    rank,
    flatBonus,
    shards,
    assignments,
    apply: shouldApply,
    actorId,
    tokenId,
  });
}

/**
 * Manual / macro entry point.
 * Call from a Foundry macro:  game.modules.get("force-barrage")?.api?.openDialog()
 */
export function openDialogManual() {
  const token = canvas.tokens?.controlled?.[0] ?? null;
  const actorId = token?.actor?.id ?? null;
  const tokenId = token?.document?.id ?? token?.id ?? null;
  openForceBarrageDialog({ rank: null, actorId, tokenId });
}
