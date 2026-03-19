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

/**
 * Try to resolve a flat spell-damage bonus from the actor's PF2e synthetics.
 * Returns 0 when the bonus cannot be reliably determined (the dialog exposes a
 * manual input as a fallback).
 *
 * @param {string|null} actorId
 * @returns {number}
 */
export function getSpellDamageBonus(actorId) {
  if (!actorId) return 0;
  try {
    const actor = game.actors.get(actorId);
    if (!actor) return 0;

    // Only check "spell-damage" selector — "damage" is too broad and
    // would include weapon/unarmed bonuses that don't apply here.
    const synthetics = actor.synthetics;
    if (synthetics?.modifiers) {
      const mods = synthetics.modifiers["spell-damage"];
      if (Array.isArray(mods)) {
        let bonus = 0;
        for (const mod of mods) {
          if (typeof mod.value !== "number" || mod.value <= 0) continue;
          const type = mod.type ?? "";
          if (
            type === "status" ||
            type === "circumstance" ||
            type === "item" ||
            type === "untyped"
          ) {
            bonus += mod.value;
            log(
              `getSpellDamageBonus: found ${mod.label ?? mod.slug ?? "modifier"} (${type}) = +${mod.value}`,
            );
          }
        }
        if (bonus > 0) return bonus;
      }
    }

    // Detect feats that grant spell damage bonuses but whose value we can't
    // programmatically extract — signal this via debug log so the user knows
    // to use the manual input.
    const bonusFeats = ["dangerous-sorcery", "sorcerous-potency"];
    for (const item of actor.items) {
      const slug = (item.slug ?? item.system?.slug ?? "").toLowerCase();
      if (bonusFeats.includes(slug)) {
        log(
          `getSpellDamageBonus: detected feat "${item.name}" but cannot auto-resolve its value. Use the manual flat-bonus field in the dialog.`,
        );
        return 0;
      }
    }
  } catch (e) {
    log("getSpellDamageBonus: error resolving bonus", e);
  }
  return 0;
}
