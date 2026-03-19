import {
  FORCE_BASE_RANK,
  FORCE_HEIGHTEN_INTERVAL,
  MIN_ACTIONS,
  MAX_ACTIONS,
} from "./constants.js";

/**
 * Calculate the number of heighten steps above base rank.
 * steps = floor((rank - 1) / 2)
 *
 * @param {number} rank - Effective spell rank (>=1).
 * @returns {number}
 */
export function heightenSteps(rank) {
  const effective = Math.max(FORCE_BASE_RANK, Math.floor(rank));
  return Math.floor((effective - FORCE_BASE_RANK) / FORCE_HEIGHTEN_INTERVAL);
}

/**
 * Calculate total shards for a given action count and spell rank.
 * shards = actions * (1 + steps)
 *
 * @param {number} actions - Number of actions spent (1–3).
 * @param {number} rank    - Effective spell rank.
 * @returns {number}
 */
export function totalShards(actions, rank) {
  const a = Math.max(MIN_ACTIONS, Math.min(MAX_ACTIONS, Math.floor(actions)));
  return a * (1 + heightenSteps(rank));
}

/**
 * Build a dice formula for N shards.
 * Each shard = 1d4+1, combined: Nd4+N
 *
 * @param {number} shards - Number of shards assigned to this target.
 * @param {number} [flatBonus=0] - Additional flat bonus (e.g. Sorcerous Potency).
 * @returns {string} e.g. "3d4 + 3" or "3d4 + 5" with bonus
 */
export function shardFormula(shards, flatBonus = 0) {
  const n = Math.max(1, Math.floor(shards));
  const totalFlat = n + flatBonus;
  return `${n}d4 + ${totalFlat}`;
}
