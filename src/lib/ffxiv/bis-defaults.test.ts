import { describe, expect, it } from "vitest";

import { defaultBisChoicesForJob } from "./bis-defaults";
import { SLOTS } from "./slots";

describe("defaultBisChoicesForJob", () => {
  it("emits exactly one row per slot", () => {
    const rows = defaultBisChoicesForJob("WHM");
    expect(rows).toHaveLength(SLOTS.length);
    expect(new Set(rows.map((r) => r.slot)).size).toBe(SLOTS.length);
  });

  it("defaults every wearable slot to currentSource = Crafted for non-PLD jobs", () => {
    // Topic 2.2 onboarding — Crafted is the canonical pre-tier
    // baseline, so the algorithm sees the team upgrading FROM
    // Crafted on day 1 instead of an empty BiS table.
    const rows = defaultBisChoicesForJob("WAR");
    for (const row of rows) {
      if (row.slot === "Offhand") continue;
      expect(row.currentSource).toBe("Crafted");
    }
  });

  it("leaves the Offhand slot NotPlanned for non-PLD jobs", () => {
    // Non-Paladin jobs never see an Offhand drop, so even the
    // current-source field stays empty to avoid the algorithm
    // ever scoring shield/offhand pickups for them.
    for (const job of ["WAR", "DRK", "GNB", "WHM", "BLM", "DRG"]) {
      const offhand = defaultBisChoicesForJob(job).find(
        (r) => r.slot === "Offhand",
      );
      expect(offhand?.currentSource).toBe("NotPlanned");
      expect(offhand?.desiredSource).toBe("NotPlanned");
    }
  });

  it("treats Paladins like any other job and gives Offhand currentSource = Crafted", () => {
    const offhand = defaultBisChoicesForJob("PLD").find(
      (r) => r.slot === "Offhand",
    );
    expect(offhand?.currentSource).toBe("Crafted");
  });

  it("leaves desiredSource NotPlanned everywhere so the user explicitly opts in to upgrades", () => {
    // The algorithm only scores slots whose desired differs from
    // current — keeping desired at NotPlanned means we don't
    // recommend a single drop until the team picks targets.
    for (const job of ["WAR", "PLD", "WHM", "DRG", "BLM"]) {
      for (const row of defaultBisChoicesForJob(job)) {
        expect(row.desiredSource).toBe("NotPlanned");
      }
    }
  });
});
