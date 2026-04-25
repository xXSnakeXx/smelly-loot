import { describe, expect, it } from "vitest";

import { GEAR_ROLES, JOB_CODES, jobToGearRole, ROLE_WEIGHTS } from "./jobs";

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

describe("ROLE_WEIGHTS", () => {
  it("matches the Topic 1 decision (2026-04-25)", () => {
    expect(ROLE_WEIGHTS).toEqual({
      tank: 1.0,
      healer: 1.0,
      caster: 1.0,
      phys_range: 1.05,
      melee: 1.1,
    });
  });

  it("never gives any role less than the neutral 1.00 weight", () => {
    for (const role of GEAR_ROLES) {
      expect(ROLE_WEIGHTS[role]).toBeGreaterThanOrEqual(1);
    }
  });
});
