/**
 * FF XIV combat-job catalogue + gear-role mapping.
 *
 * Centralises the `Job → GearRole` lookup that drives the algorithm's
 * `role_weight`. Adding a new job (e.g. Beastmaster, when it lands as
 * a combat job) is a single line change here; the algorithm and UI
 * pick up the new entry automatically.
 *
 * Gear roles loosely follow Square Enix's gear-type pools, with one
 * deliberate consolidation: Maiming, Striking, and Scouting all map
 * to the umbrella `melee` role because in modern FF XIV all armor
 * pieces drop as universal coffers — distinguishing the three subtypes
 * for loot competition no longer matches reality. The `role_weight`
 * lives one layer above this lookup so a future tier-config rework
 * could re-introduce the split without touching this file.
 */

export const JOB_CODES = [
  // Tanks
  "PLD",
  "WAR",
  "DRK",
  "GNB",
  // Healers
  "WHM",
  "SCH",
  "AST",
  "SGE",
  // Melee DPS
  "DRG",
  "MNK",
  "SAM",
  "NIN",
  "RPR",
  "VPR",
  // Phys-Ranged DPS
  "BRD",
  "MCH",
  "DNC",
  // Caster DPS
  "BLM",
  "SMN",
  "RDM",
  "PCT",
] as const;

export type JobCode = (typeof JOB_CODES)[number];

export const GEAR_ROLES = [
  "tank",
  "healer",
  "melee",
  "phys_range",
  "caster",
] as const;

export type GearRole = (typeof GEAR_ROLES)[number];

const JOB_TO_ROLE: Record<JobCode, GearRole> = {
  // Tanks (Fending)
  PLD: "tank",
  WAR: "tank",
  DRK: "tank",
  GNB: "tank",
  // Healers (Healing)
  WHM: "healer",
  SCH: "healer",
  AST: "healer",
  SGE: "healer",
  // Melee DPS (Maiming + Striking + Scouting)
  DRG: "melee",
  MNK: "melee",
  SAM: "melee",
  NIN: "melee",
  RPR: "melee",
  VPR: "melee",
  // Phys-Ranged DPS (Aiming)
  BRD: "phys_range",
  MCH: "phys_range",
  DNC: "phys_range",
  // Caster DPS (Casting)
  BLM: "caster",
  SMN: "caster",
  RDM: "caster",
  PCT: "caster",
};

/**
 * Resolve a job code to its gear role.
 *
 * Returns `undefined` for unknown job codes so callers can decide
 * whether to fall back, throw, or surface a validation error. The
 * `JobCode` type makes typo bugs impossible at the call site, but the
 * lookup is intentionally permissive at runtime so seed data and
 * imported player profiles can degrade gracefully.
 */
export function jobToGearRole(job: string): GearRole | undefined {
  return JOB_TO_ROLE[job as JobCode];
}

/**
 * Per-role weight for the loot-distribution algorithm.
 *
 * Decision (Topic 1, 2026-04-25): Tanks, Healers, and Caster DPS share
 * the broader gear pools (4-job Fending / Healing / Casting) and
 * compete on roughly equal footing, so they take the neutral weight.
 * Phys-Ranged DPS gets a small boost; Melee DPS gets a slightly larger
 * one, reflecting both the smaller per-subtype pool and the higher
 * uptime risk. A per-tier slider that overrides this table is on the
 * Phase 2 roadmap.
 */
export const ROLE_WEIGHTS: Record<GearRole, number> = {
  tank: 1.0,
  healer: 1.0,
  caster: 1.0,
  phys_range: 1.05,
  melee: 1.1,
};
