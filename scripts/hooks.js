import { MODULE_ID, FORCE_BARRAGE_SLUGS } from "./constants.js";
import { log } from "./debug.js";

/**
 * Canonical spell names used for name-based matching.
 * Must be in normalized form: lowercase, hyphens replaced by spaces.
 */
const NAME_PATTERNS = ["force barrage", "magic missile"];

/** Set for O(1) exact-match lookup against normalized names. */
const VALID_NAMES = new Set(NAME_PATTERNS);

/**
 * Returns the built-in slug list for detection.
 * @returns {string[]}
 */
export function getSpellSlugs() {
  return FORCE_BARRAGE_SLUGS;
}

/**
 * Detect whether a chat message represents a Force Barrage cast.
 *
 * Detection layers (conservative → broad):
 *   1. flags.pf2e.origin.rollOptions — PF2e 7.x puts item slugs here, not
 *      on origin directly.  Also reads castRank from origin.
 *   2. flags.pf2e.casting.embeddedSpell — scroll/wand consumable casts embed
 *      the full spell object here with slug and name.
 *   3. message content — last-resort name search in rendered HTML.
 *      Tries to recover cast rank from the HTML data-cast-rank attribute.
 *
 * @param {ChatMessage} message
 * @returns {{ detected: boolean, rank: number|null, actorId: string|null, tokenId: string|null }}
 */
export function detectForceBarrage(message) {
  const none = Object.freeze({
    detected: false,
    rank: null,
    actorId: null,
    tokenId: null,
  });
  if (!message) return none;

  const slugs = getSpellSlugs();
  const speakerActorId = asStringOrNull(message.speaker?.actor);
  const speakerTokenId = asStringOrNull(message.speaker?.token);
  const pf2eFlags = message.flags?.pf2e;
  const origin = pf2eFlags?.origin;

  // Log all rank-related fields on origin for debugging
  if (origin && typeof origin === "object") {
    log("detectForceBarrage: origin dump", {
      type: origin.type,
      uuid: origin.uuid,
      castRank: origin.castRank,
      castLevel: origin.castLevel,
      spellRank: origin.spellRank,
      rank: origin.rank,
      level: origin.level,
      rollOptionSlugs: Array.isArray(origin.rollOptions)
        ? origin.rollOptions.filter((o) => typeof o === "string" && o.includes(":slug:"))
        : [],
    });
  }

  // --- Layer 1: flags.pf2e.origin rollOptions slug matching ---
  // PF2e 7.x puts "origin:item:slug:force-barrage" (etc.) in rollOptions,
  // NOT on origin.slug/origin.name (those fields do not exist).
  if (origin && typeof origin === "object") {
    const matchedOption = matchOriginByRollOptions(origin, slugs);
    if (matchedOption) {
      const rank =
        extractCastRank(origin, "flags.pf2e.origin") ??
        extractRankFromHtml(message.content);
      log("detectForceBarrage: MATCHED layer 1 (origin.rollOptions)", {
        matchedOption,
        resolvedRank: rank,
      });
      return {
        detected: true,
        rank,
        actorId: speakerActorId,
        tokenId: speakerTokenId,
      };
    }
    log("detectForceBarrage: layer 1 checked, no rollOptions slug match");
  }

  // --- Layer 2: flags.pf2e.casting.embeddedSpell (scroll/wand/staff) ---
  const embeddedSpell = pf2eFlags?.casting?.embeddedSpell;
  if (embeddedSpell && typeof embeddedSpell === "object") {
    const embSlug = (
      embeddedSpell.system?.slug ?? embeddedSpell.slug ?? ""
    ).toLowerCase();
    const embName = (embeddedSpell.name ?? "").toLowerCase();

    if (matchesSlug(embSlug, slugs) || matchesName(embName)) {
      const rank =
        extractCastRank(origin ?? {}, "flags.pf2e.origin") ??
        extractRankFromHtml(message.content);
      log("detectForceBarrage: MATCHED layer 2 (casting.embeddedSpell)", {
        slug: embSlug,
        name: embName,
        resolvedRank: rank,
      });
      return {
        detected: true,
        rank,
        actorId: speakerActorId,
        tokenId: speakerTokenId,
      };
    }
    log("detectForceBarrage: layer 2 checked, no match", {
      slug: embSlug,
      name: embName,
    });
  }

  // --- Layer 3: content fallback (rendered HTML) ---
  // Guard: only fire when an actor speaker is present.  Without this, ambient
  // GM text that merely mentions the spell name (e.g. flavor pasted into chat)
  // would incorrectly trigger the dialog.
  if (speakerActorId) {
    const normContent = normalizeName(message.content ?? "");
    if (NAME_PATTERNS.some((p) => normContent.includes(p))) {
      const rank =
        extractCastRank(origin ?? {}, "flags.pf2e.origin") ??
        extractRankFromHtml(message.content);
      log("detectForceBarrage: MATCHED layer 3 (content fallback)", {
        resolvedRank: rank,
      });
      return {
        detected: true,
        rank,
        actorId: speakerActorId,
        tokenId: speakerTokenId,
      };
    }
  }

  log("detectForceBarrage: no match on any layer", {
    hasOrigin: !!origin,
    hasCasting: !!pf2eFlags?.casting,
    contentSnippet: (message.content ?? "").slice(0, 120),
  });
  return none;
}

/* ---------- detection helpers ---------- */

/** Exact slug equality check (not substring). */
function matchesSlug(value, slugs) {
  return value.length > 0 && slugs.includes(value);
}

/**
 * Check origin.rollOptions for a known spell slug.
 * PF2e 7.x puts options like "origin:item:slug:force-barrage" in this array.
 *
 * @param {object} origin - flags.pf2e.origin
 * @param {string[]} slugs - known spell slugs
 * @returns {string|null} the matched rollOption string, or null
 */
function matchOriginByRollOptions(origin, slugs) {
  const rollOptions = origin.rollOptions;
  if (!Array.isArray(rollOptions)) return null;
  for (const opt of rollOptions) {
    if (typeof opt !== "string") continue;
    for (const slug of slugs) {
      if (opt.endsWith(`:slug:${slug}`) || opt === `slug:${slug}`) {
        return opt;
      }
    }
  }
  return null;
}

/**
 * Try to extract cast rank from the PF2e chat card HTML.
 * PF2e puts data-cast-rank="N" on the .chat-card div element.
 */
function extractRankFromHtml(content) {
  if (!content) return null;
  const match = content.match(/data-cast-rank=["'](\d+)["']/);
  if (match) {
    const rank = parseInt(match[1], 10);
    if (rank >= 1 && rank <= 10) {
      log(`extractRankFromHtml: found data-cast-rank=${rank}`);
      return rank;
    }
  }
  return null;
}

/**
 * Normalize a name for comparison: lowercase, collapse hyphens/apostrophes
 * to spaces, then trim and collapse runs of whitespace.
 */
function normalizeName(str) {
  return (str ?? "")
    .toLowerCase()
    .replace(/[-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match a name string against known Force Barrage spell names.
 * 1. Exact normalized match — highest confidence.
 * 2. Prefix match — handles parenthetical suffixes like
 *    "Force Barrage (Heightened)" without matching mid-string occurrences
 *    like "Counter Force Barrage".
 */
function matchesName(rawValue) {
  if (!rawValue) return false;
  const norm = normalizeName(rawValue);
  if (!norm) return false;
  // Exact match
  if (VALID_NAMES.has(norm)) return true;
  // Prefix match — must be followed by a space, "(", or end-of-string
  return NAME_PATTERNS.some(
    (p) => norm === p || norm.startsWith(p + " ") || norm.startsWith(p + "("),
  );
}

/**
 * Extract the *cast* rank from a PF2e flag object.
 *
 * Priority:
 *   1. castRank  — PF2e 7.x, the authoritative cast rank field
 *   2. castLevel — older PF2e, same meaning (migrated to castRank)
 *   3. spellRank — sometimes present on origin objects
 *
 * We deliberately skip generic fields like `rank`, `level`,
 * `system.level.value` because those can reflect the spell's *base*
 * level rather than the heightened cast rank.
 */
function extractCastRank(obj, source) {
  // Log every rank-related field we can find
  const found = {};
  for (const field of ["castRank", "castLevel", "spellRank", "rank", "level"]) {
    if (obj[field] !== undefined) found[field] = obj[field];
  }
  log(`extractCastRank: scanning ${source}`, found);

  // Prefer fields that explicitly represent the cast/heightened rank
  for (const field of ["castRank", "castLevel", "spellRank"]) {
    const v = obj[field];
    if (typeof v === "number" && v >= 1) {
      log(`extractCastRank: SELECTED ${source}.${field} = ${v}`);
      return v;
    }
  }
  // Fallback to base-level fields only if cast-rank fields are absent
  for (const field of ["rank", "level"]) {
    const v = obj[field];
    if (typeof v === "number" && v >= 1) {
      log(
        `extractCastRank: WARNING fallback to ${source}.${field} = ${v} (castRank/castLevel not found)`,
      );
      return v;
    }
  }
  log(`extractCastRank: no rank found on ${source}`);
  return null;
}

function asStringOrNull(v) {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/* ---------- spell damage bonus ---------- */

const BONUS_TYPES = new Set(["status", "circumstance", "item", "untyped"]);

/**
 * Normalize a modifier type string.  PF2e uses lowercase type names but some
 * modifiers might have empty or missing types — treat those as "untyped".
 */
function normalizeBonusType(raw) {
  const t = (raw ?? "").toLowerCase();
  return BONUS_TYPES.has(t) ? t : t === "" ? "untyped" : null;
}

/**
 * Resolve flat spell-damage bonuses from the caster's PF2e data.
 *
 * Strategy (most reliable first):
 *   1. Item rule-element scan — looks for FlatModifier rules targeting
 *      "spell-damage" on feats/features/effects and resolves values using
 *      the known cast rank.  Best for rank-dependent bonuses like
 *      Dangerous Sorcery.
 *   2. actor.synthetics.modifiers["spell-damage"] — PF2e's runtime modifier
 *      pipeline.  Catches modifiers injected by code rather than rule
 *      elements.  Deferred functions are called without spell context so
 *      rank-dependent values may not resolve perfectly.
 *
 * Stacking: status / circumstance / item — only the highest of each type
 * applies. Untyped always stacks.  This mirrors PF2e's own rules.
 *
 * @param {string|null} actorId
 * @param {number}      rank - Current spell rank (used to resolve rank-dependent values).
 * @returns {{ bonus: number, sources: Array<{label: string, type: string, value: number}> }}
 */
export function getSpellDamageBonus(actorId, rank = 1) {
  const empty = Object.freeze({ bonus: 0, sources: [] });
  if (!actorId) return empty;

  try {
    const actor = game.actors.get(actorId);
    if (!actor) return empty;

    // --- Approach 1: Rule-element scan (preferred — we resolve rank ourselves) ---
    const ruleResult = resolveFromRuleElements(actor, rank);
    if (ruleResult.bonus > 0) {
      log("getSpellDamageBonus: resolved from item rule elements", ruleResult);
      return ruleResult;
    }

    // --- Approach 2: PF2e synthetics (fallback — catches code-injected modifiers) ---
    const synthResult = resolveFromSynthetics(actor);
    if (synthResult.bonus > 0) {
      log("getSpellDamageBonus: resolved from synthetics", synthResult);
      return synthResult;
    }

    log("getSpellDamageBonus: no spell-damage bonus found for actor", actorId);
  } catch (e) {
    log("getSpellDamageBonus: error resolving bonus", e);
  }
  return empty;
}

/**
 * Scan actor items for FlatModifier rule elements targeting "spell-damage".
 * Resolves value expressions like "@spell.rank" using the known cast rank.
 */
function resolveFromRuleElements(actor, rank) {
  const bestByType = {};
  let untypedSum = 0;
  const untypedSources = [];
  const allCandidates = [];

  for (const item of actor.items) {
    // Only check feat / feature / effect items
    const isRelevant = (typeof item.isOfType === "function")
      ? item.isOfType("feat", "feature", "effect")
      : ["feat", "feature", "effect"].includes(item.type ?? "");
    if (!isRelevant) continue;

    const rules = item.system?.rules ?? [];
    for (const rule of rules) {
      if (rule.key !== "FlatModifier") continue;
      if (rule.selector !== "spell-damage") continue;

      const val = resolveRuleValue(rule.value, rank);
      const type = normalizeBonusType(rule.type);
      const label = item.name ?? rule.label ?? "rule element";

      allCandidates.push({ label, type, rawValue: rule.value, resolvedValue: val });

      if (val == null || val <= 0) continue;
      if (type == null) continue;

      if (type === "untyped") {
        untypedSum += val;
        untypedSources.push({ label, type, value: val });
      } else {
        if (!bestByType[type] || val > bestByType[type].value) {
          bestByType[type] = { label, type, value: val };
        }
      }
    }
  }

  if (allCandidates.length > 0) {
    log("getSpellDamageBonus (rules): candidates found", allCandidates);
  }

  let bonus = untypedSum;
  const sources = [...untypedSources];
  for (const entry of Object.values(bestByType)) {
    bonus += entry.value;
    sources.push(entry);
  }
  return { bonus, sources };
}

/**
 * Resolve modifiers from actor.synthetics.modifiers["spell-damage"].
 * Handles both pre-resolved Modifier objects and deferred () => Modifier functions.
 */
function resolveFromSynthetics(actor) {
  const deferredMods = actor.synthetics?.modifiers?.["spell-damage"];
  if (!Array.isArray(deferredMods) || deferredMods.length === 0) {
    return { bonus: 0, sources: [] };
  }

  const bestByType = {};
  let untypedSum = 0;
  const untypedSources = [];
  const allCandidates = [];

  for (const entry of deferredMods) {
    let mod;
    try {
      mod = typeof entry === "function" ? entry() : entry;
    } catch { continue; }
    if (!mod) continue;
    if (mod.ignored || mod.suppressed) continue;

    // PF2e Modifier stores its value in .modifier (resolved) or .value
    const val = typeof mod.modifier === "number" ? mod.modifier
              : typeof mod.value === "number"    ? mod.value
              : null;
    const type = normalizeBonusType(mod.type);
    const label = mod.label ?? mod.slug ?? "modifier";

    allCandidates.push({ label, type, value: val, ignored: mod.ignored, suppressed: mod.suppressed });

    if (val == null || val <= 0) continue;
    if (type == null) continue;

    if (type === "untyped") {
      untypedSum += val;
      untypedSources.push({ label, type, value: val });
    } else {
      if (!bestByType[type] || val > bestByType[type].value) {
        bestByType[type] = { label, type, value: val };
      }
    }
  }

  if (allCandidates.length > 0) {
    log("getSpellDamageBonus (synthetics): candidates found", allCandidates);
  }

  let bonus = untypedSum;
  const sources = [...untypedSources];
  for (const entry of Object.values(bestByType)) {
    bonus += entry.value;
    sources.push(entry);
  }
  return { bonus, sources };
}

/** Resolve a rule-element value to a number, substituting known roll data. */
function resolveRuleValue(val, rank) {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    // Common PF2e roll-data references for spell rank
    if (val === "@spell.rank" || val === "@item.rank" || val === "@spell.level") {
      return rank;
    }
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof val === "object" && val !== null) {
    // Bracket notation: { value: N } or nested
    if (typeof val.value === "number") return val.value;
  }
  return null;
}
