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
 *   1. flags.pf2e.origin  — set by PF2e on spell/consumable item usage
 *   2. flags.pf2e.casting or flags.pf2e.item — older PF2e / some consumables
 *   3. message content    — last-resort name search in rendered HTML
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

  // --- Layer 1: flags.pf2e.origin (most reliable for spells, wands, scrolls, staves) ---
  const origin = message.flags?.pf2e?.origin;
  if (origin && typeof origin === "object") {
    const originSlug = (origin.slug ?? origin.sourceSlug ?? "").toLowerCase();
    const originName = (origin.name ?? "").toLowerCase();

    if (matchesSlug(originSlug, slugs) || matchesName(originName)) {
      const rank = extractCastRank(origin, "flags.pf2e.origin");
      log("detectForceBarrage: MATCHED layer 1 (flags.pf2e.origin)", {
        slug: originSlug,
        name: originName,
        rank,
        rawFields: {
          castRank: origin.castRank,
          castLevel: origin.castLevel,
          type: origin.type,
        },
      });
      return {
        detected: true,
        rank,
        actorId: speakerActorId,
        tokenId: speakerTokenId,
      };
    }
    log("detectForceBarrage: layer 1 checked, no match", {
      slug: originSlug,
      name: originName,
    });
  }

  // --- Layer 2: flags.pf2e.casting or flags.pf2e.item (older PF2e / some consumables) ---
  const castingOrItem =
    message.flags?.pf2e?.casting ?? message.flags?.pf2e?.item;
  if (castingOrItem && typeof castingOrItem === "object") {
    const itemSlug = (castingOrItem.slug ?? "").toLowerCase();
    const itemName = (castingOrItem.name ?? "").toLowerCase();

    if (matchesSlug(itemSlug, slugs) || matchesName(itemName)) {
      const rank = extractCastRank(castingOrItem, "flags.pf2e.casting/item");
      log("detectForceBarrage: MATCHED layer 2 (flags.pf2e.casting/item)", {
        slug: itemSlug,
        name: itemName,
        rank,
      });
      return {
        detected: true,
        rank,
        actorId: speakerActorId,
        tokenId: speakerTokenId,
      };
    }
    log("detectForceBarrage: layer 2 checked, no match", {
      slug: itemSlug,
      name: itemName,
    });
  }

  // --- Layer 3: content fallback (rendered HTML) ---
  // Guard: only fire when an actor speaker is present.  Without this, ambient
  // GM text that merely mentions the spell name (e.g. flavor pasted into chat)
  // would incorrectly trigger the dialog.
  if (speakerActorId) {
    const normContent = normalizeName(message.content ?? "");
    if (NAME_PATTERNS.some((p) => normContent.includes(p))) {
      log(
        "detectForceBarrage: MATCHED layer 3 (content fallback, rank unknown)",
      );
      return {
        detected: true,
        rank: null,
        actorId: speakerActorId,
        tokenId: speakerTokenId,
      };
    }
  }

  log("detectForceBarrage: no match on any layer", {
    hasOrigin: !!origin,
    hasCasting: !!castingOrItem,
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
 *   1. castRank  — modern PF2e (5.x+), reflects heightened rank
 *   2. castLevel — older PF2e, same meaning
 *   3. spellRank — sometimes present on origin objects
 *
 * We deliberately skip generic fields like `rank`, `level`,
 * `system.level.value` because those can reflect the spell's *base*
 * level rather than the heightened cast rank.
 */
function extractCastRank(obj, source) {
  // Prefer fields that explicitly represent the cast/heightened rank
  for (const field of ["castRank", "castLevel", "spellRank"]) {
    const v = obj[field];
    if (typeof v === "number" && v >= 1) {
      log(`extractCastRank: using ${source}.${field} = ${v}`);
      return v;
    }
  }
  // Fallback to base-level fields only if cast-rank fields are absent
  for (const field of ["rank", "level"]) {
    const v = obj[field];
    if (typeof v === "number" && v >= 1) {
      log(
        `extractCastRank: WARNING using base field ${source}.${field} = ${v} (castRank/castLevel not found — this may be the base rank, not the heightened rank)`,
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
 * Resolve flat spell-damage bonuses from the caster's PF2e data.
 *
 * Strategy (most reliable first):
 *   1. actor.synthetics.modifiers["spell-damage"] — PF2e's native modifier
 *      pipeline.  Entries may be pre-resolved Modifier objects or deferred
 *      functions; we handle both.
 *   2. Item rule-element scan — looks for FlatModifier rules targeting
 *      "spell-damage" on feats/features/effects and tries to resolve the
 *      value (including simple @spell.rank references).
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

    // --- Approach 1: PF2e synthetics ("spell-damage" selector) ---
    const result = resolveFromSynthetics(actor);
    if (result.bonus > 0) {
      log("getSpellDamageBonus: resolved from synthetics", result);
      return result;
    }

    // --- Approach 2: Rule-element scan on actor items ---
    const ruleResult = resolveFromRuleElements(actor, rank);
    if (ruleResult.bonus > 0) {
      log("getSpellDamageBonus: resolved from item rule elements", ruleResult);
      return ruleResult;
    }

    log("getSpellDamageBonus: no spell-damage bonus found for actor", actorId);
  } catch (e) {
    log("getSpellDamageBonus: error resolving bonus", e);
  }
  return empty;
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

  const bestByType = {};   // type → { label, value }
  let untypedSum = 0;
  const untypedSources = [];

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
    if (val == null || val <= 0) continue;

    const type = (mod.type ?? "").toLowerCase();
    if (!BONUS_TYPES.has(type)) continue;

    const label = mod.label ?? mod.slug ?? "modifier";

    if (type === "untyped" || type === "") {
      untypedSum += val;
      untypedSources.push({ label, type: "untyped", value: val });
    } else {
      // Same-type bonuses: keep only the highest
      if (!bestByType[type] || val > bestByType[type].value) {
        bestByType[type] = { label, type, value: val };
      }
    }
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
 * Fallback: scan actor items for FlatModifier rule elements targeting
 * "spell-damage".  Tries to resolve simple value expressions like
 * "@spell.rank" using the known cast rank.
 */
function resolveFromRuleElements(actor, rank) {
  const bestByType = {};
  let untypedSum = 0;
  const untypedSources = [];

  for (const item of actor.items) {
    // Only check feat / feature / effect items
    const itemType = item.type ?? "";
    const isRelevant = (typeof item.isOfType === "function")
      ? item.isOfType("feat", "feature", "effect")
      : ["feat", "feature", "effect"].includes(itemType);
    if (!isRelevant) continue;

    const rules = item.system?.rules ?? [];
    for (const rule of rules) {
      if (rule.key !== "FlatModifier") continue;
      if (rule.selector !== "spell-damage") continue;

      const val = resolveRuleValue(rule.value, rank);
      if (val == null || val <= 0) continue;

      const type = (rule.type ?? "untyped").toLowerCase();
      if (!BONUS_TYPES.has(type)) continue;

      const label = item.name ?? rule.label ?? "rule element";

      if (type === "untyped" || type === "") {
        untypedSum += val;
        untypedSources.push({ label, type: "untyped", value: val });
      } else {
        if (!bestByType[type] || val > bestByType[type].value) {
          bestByType[type] = { label, type, value: val };
        }
      }
    }
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
