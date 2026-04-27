import { describe, expect, it } from "vitest";

import { GEAR_ROLES, JOB_CODES, jobToGearRole } from "./jobs";

describe("jobToGearRole", () => {
  it("classifies the four tank jobs as `tank`", () => {
    for (const job of ["PLD", "WAR", "DRK", "GNB"] as const) {
      expect(jobToGearRole(job)).toBe("tank");
    }
  });

  it("classifies the four healer jobs as `healer`", () => {
    for (const job of ["WHM", "SCH", "AST", "SGE"] as const) {
      expect(jobToGearRole(job)).toBe("healer");
    }
  });

  it("classifies every melee DPS job as `melee`", () => {
    for (const job of ["DRG", "MNK", "SAM", "NIN", "RPR", "VPR"] as const) {
      expect(jobToGearRole(job)).toBe("melee");
    }
  });

  it("classifies the three phys-ranged jobs as `phys_range`", () => {
    for (const job of ["BRD", "MCH", "DNC"] as const) {
      expect(jobToGearRole(job)).toBe("phys_range");
    }
  });

  it("classifies the four caster DPS jobs as `caster`", () => {
    for (const job of ["BLM", "SMN", "RDM", "PCT"] as const) {
      expect(jobToGearRole(job)).toBe("caster");
    }
  });

  it("returns undefined for unknown job codes so callers can decide how to fall back", () => {
    expect(jobToGearRole("BMR")).toBeUndefined();
    expect(jobToGearRole("")).toBeUndefined();
  });
});

describe("JOB_CODES", () => {
  it("covers all 21 current FF XIV combat jobs", () => {
    expect(JOB_CODES).toHaveLength(21);
  });

  it("contains no duplicates", () => {
    expect(new Set(JOB_CODES).size).toBe(JOB_CODES.length);
  });

  it("maps every code to a defined gear role", () => {
    for (const job of JOB_CODES) {
      const role = jobToGearRole(job);
      expect(role).toBeDefined();
      expect(GEAR_ROLES).toContain(role);
    }
  });
});
