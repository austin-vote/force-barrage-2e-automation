export const MODULE_ID = "force-barrage";

/** Slugs used to detect Force Barrage casts from chat messages. */
export const FORCE_BARRAGE_SLUGS = [
  "force-barrage",
  "spell-force-barrage",
  "magic-missile",          // legacy / pre-remaster name
  "spell-magic-missile",
];

export const FORCE_DAMAGE_DIE = "d4";
export const FORCE_DAMAGE_FLAT = 1;
export const FORCE_DAMAGE_TYPE = "force";

/** Spell rank at which Force Barrage starts. */
export const FORCE_BASE_RANK = 1;

/** Heightened every +2 ranks. */
export const FORCE_HEIGHTEN_INTERVAL = 2;

/** Min/max action counts. */
export const MIN_ACTIONS = 1;
export const MAX_ACTIONS = 3;
