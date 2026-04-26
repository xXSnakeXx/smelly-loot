import { describe, expect, it } from "vitest";

import type { GearRole } from "@/lib/ffxiv/jobs";
import { type BisSource, deriveSourceIlvs, type Slot } from "@/lib/ffxiv/slots";

import {
  type DropContext,
  type PlayerSnapshot,
  scoreDrop,
  type TierSnapshot,
} from "./algorithm";

/**
 * Test fixtures.
 *
 * `makeTier` produces the Heavyweight defaults so the assertions below
 * mirror what the seed data would produce on a real deployment. Buy
 * costs are wired up to match the FFXIV wiki numbers we transcribed.
 */
function makeTier(): TierSnapshot {
  const ilvs = deriveSourceIlvs(795);
  return {
    maxIlv: 795,
    ilvSavage: ilvs.Savage,
    ilvTomeUp: ilvs.TomeUp,
    ilvCatchup: ilvs.Catchup,
    ilvTome: ilvs.Tome,
    ilvExtreme: ilvs.Extreme,
    ilvRelic: ilvs.Relic,
    ilvCrafted: ilvs.Crafted,
    ilvWhyyyy: ilvs.WHYYYY,
    ilvJustNo: ilvs.JustNo,
    buyCostByItem: new Map<string, { floor: number; cost: number }>([
      ["Earring", { floor: 1, cost: 3 }],
      ["Necklace", { floor: 1, cost: 3 }],
      ["Bracelet", { floor: 1, cost: 3 }],
      ["Ring", { floor: 1, cost: 3 }],
      ["Head", { floor: 2, cost: 4 }],
      ["Gloves", { floor: 2, cost: 4 }],
      ["Boots", { floor: 2, cost: 4 }],
      ["Glaze", { floor: 2, cost: 3 }],
      ["Chestpiece", { floor: 3, cost: 6 }],
      ["Pants", { floor: 3, cost: 6 }],
      ["Twine", { floor: 3, cost: 4 }],
      ["Ester", { floor: 3, cost: 4 }],
      ["Weapon", { floor: 4, cost: 8 }],
    ]) as TierSnapshot["buyCostByItem"],
  };
}

interface PlayerOptions {
  id: number;
  name: string;
  gearRole: GearRole;
  bisDesired?: Partial<Record<Slot, BisSource>>;
  bisCurrent?: Partial<Record<Slot, BisSource>>;
  pages?: Partial<Record<number, number>>;
  materialsReceived?: Partial<Record<"Glaze" | "Twine" | "Ester", number>>;
  savageDropsThisTier?: number;
  lastDropWeekByFloor?: Partial<Record<number, number | null>>;
}

function makePlayer(opts: PlayerOptions): PlayerSnapshot {
  return {
    id: opts.id,
    name: opts.name,
    gearRole: opts.gearRole,
    bisDesired: new Map(
      Object.entries(opts.bisDesired ?? {}).map(([k, v]) => [
        k as Slot,
        v as BisSource,
      ]),
    ),
    bisCurrent: new Map(
      Object.entries(opts.bisCurrent ?? {}).map(([k, v]) => [
        k as Slot,
        v as BisSource,
      ]),
    ),
    pages: new Map(
      Object.entries(opts.pages ?? {}).map(([k, v]) => [
        Number(k),
        v as number,
      ]),
    ),
    materialsReceived: new Map(
      Object.entries(opts.materialsReceived ?? {}).map(([k, v]) => [
        k as "Glaze" | "Twine" | "Ester",
        v as number,
      ]),
    ),
    savageDropsThisTier: opts.savageDropsThisTier ?? 0,
    lastDropWeekByFloor: new Map(
      Object.entries(opts.lastDropWeekByFloor ?? {}).map(([k, v]) => [
        Number(k),
        v as number | null,
      ]),
    ),
  };
}

function context(overrides: Partial<DropContext> = {}): DropContext {
  return {
    itemKey: "Earring",
    floorNumber: 1,
    currentWeek: 1,
    tier: makeTier(),
    ...overrides,
  };
}

describe("scoreDrop — gear", () => {
  it("ranks a player who needs the slot above one who already has it", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "Alice",
        gearRole: "tank",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "NotPlanned" },
      }),
      makePlayer({
        id: 2,
        name: "Bob",
        gearRole: "tank",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "Savage" },
      }),
    ];
    const [first, second] = scoreDrop(players, context());
    expect(first?.player.name).toBe("Alice");
    expect(first?.score).toBeGreaterThan(0);
    expect(second?.player.name).toBe("Bob");
    expect(second?.score).toBe(0);
  });

  it("returns score 0 for players whose desired source is not the drop source", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "WantsTome",
        gearRole: "caster",
        bisDesired: { Earring: "TomeUp" },
        bisCurrent: { Earring: "NotPlanned" },
      }),
    ];
    const [only] = scoreDrop(players, context());
    expect(only?.score).toBe(0);
    expect(only?.breakdown.effectiveNeed).toBe(0);
  });

  it("does not deprioritise page-rich players for gear drops (v2.2)", () => {
    // v2.2 — page balances no longer reduce `effectiveNeed` for gear
    // drops. The previous behaviour double-counted pages across a
    // player's multiple needed items (3 pages, 3 needed accessories
    // → each item's effective_need dropped to 0 independently even
    // though only one was actually buyable). The simpler correct
    // rule is "drops are free; pages are a separate purchase track".
    //
    // Both players still show their `buyPower` in the breakdown so
    // the UI can surface it for context — it just doesn't move the
    // score. Tiebreakers (last-drop week, deterministic hash) settle
    // the ordering when scores collide.
    const players = [
      makePlayer({
        id: 1,
        name: "PageRich",
        gearRole: "melee",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "NotPlanned" },
        pages: { 1: 6 },
      }),
      makePlayer({
        id: 2,
        name: "PagePoor",
        gearRole: "melee",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "NotPlanned" },
        pages: { 1: 2 },
      }),
    ];
    const ranking = scoreDrop(players, context());
    expect(ranking[0]?.score).toBe(ranking[1]?.score);
    expect(ranking[0]?.breakdown.effectiveNeed).toBe(1);
    expect(ranking[1]?.breakdown.effectiveNeed).toBe(1);
    const rich = ranking.find((s) => s.player.name === "PageRich");
    expect(rich?.breakdown.buyPower).toBe(2);
    const poor = ranking.find((s) => s.player.name === "PagePoor");
    expect(poor?.breakdown.buyPower).toBe(0);
  });

  it("keeps gear scores positive across multiple needed items (no buyPower double-count)", () => {
    // Regression for the Fara case: player has 3 Floor-1 pages and
    // wants 3 different Floor-1 accessories (Earring, Necklace,
    // Ring1). Pre-v2.2 each item's `effectiveNeed` dropped to 0 via
    // `slotsWanting - buyPower = 1 - 1`, so the algorithm refused to
    // recommend any of them — even though the player could only
    // ever buy *one* accessory with 3 pages.
    //
    // v2.2: `effectiveNeed` ignores buyPower for gear, so all three
    // items still score positive and the player keeps competing for
    // them on the Plan tab.
    const fara = makePlayer({
      id: 1,
      name: "Fara",
      gearRole: "tank",
      bisDesired: {
        Earring: "Savage",
        Necklace: "Savage",
        Ring1: "Savage",
      },
      bisCurrent: {
        Earring: "NotPlanned",
        Necklace: "NotPlanned",
        Ring1: "NotPlanned",
      },
      pages: { 1: 3 }, // exactly enough to buy one accessory
    });
    for (const itemKey of ["Earring", "Necklace", "Ring"] as const) {
      const [only] = scoreDrop([fara], context({ itemKey }));
      expect(only?.breakdown.effectiveNeed).toBeGreaterThan(0);
      expect(only?.score).toBeGreaterThan(0);
    }
  });

  it("applies Topic 1 role weights — melee 1.10 beats phys-range 1.05 beats caster 1.00", () => {
    // All three want the slot; all have zero pages and zero drops.
    const base = {
      bisDesired: { Earring: "Savage" } as Partial<Record<Slot, BisSource>>,
      bisCurrent: { Earring: "NotPlanned" } as Partial<Record<Slot, BisSource>>,
    };
    const players = [
      makePlayer({ id: 1, name: "Caster", gearRole: "caster", ...base }),
      makePlayer({ id: 2, name: "Range", gearRole: "phys_range", ...base }),
      makePlayer({ id: 3, name: "Melee", gearRole: "melee", ...base }),
    ];
    const ranking = scoreDrop(players, context());
    expect(ranking.map((s) => s.player.name)).toEqual([
      "Melee",
      "Range",
      "Caster",
    ]);
  });

  it("ranks the player with fewer Savage drops higher (fairness factor)", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "Lucky",
        gearRole: "tank",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "NotPlanned" },
        savageDropsThisTier: 5,
      }),
      makePlayer({
        id: 2,
        name: "Unlucky",
        gearRole: "tank",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "NotPlanned" },
        savageDropsThisTier: 0,
      }),
    ];
    const [first, second] = scoreDrop(players, context());
    expect(first?.player.name).toBe("Unlucky");
    expect(second?.player.name).toBe("Lucky");
  });

  it("applies the recency penalty when the player got a drop from the same floor recently", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "RecentWinner",
        gearRole: "tank",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "NotPlanned" },
        lastDropWeekByFloor: { 1: 4 },
      }),
      makePlayer({
        id: 2,
        name: "PatientWinner",
        gearRole: "tank",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "NotPlanned" },
        lastDropWeekByFloor: { 1: null },
      }),
    ];
    const [first] = scoreDrop(players, context({ currentWeek: 5 }));
    expect(first?.player.name).toBe("PatientWinner");
    const recent = scoreDrop(players, context({ currentWeek: 5 })).find(
      (s) => s.player.name === "RecentWinner",
    );
    expect(recent?.breakdown.recencyPenalty).toBe(15); // (4 - 1) * 5
  });

  it("treats a Ring drop as competing for both Ring1 and Ring2 BiS slots", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "BothRings",
        gearRole: "melee",
        bisDesired: { Ring1: "Savage", Ring2: "Savage" },
        bisCurrent: { Ring1: "NotPlanned", Ring2: "NotPlanned" },
      }),
      makePlayer({
        id: 2,
        name: "OneRing",
        gearRole: "melee",
        bisDesired: { Ring1: "Savage", Ring2: "TomeUp" },
        bisCurrent: { Ring1: "NotPlanned", Ring2: "NotPlanned" },
      }),
    ];
    const ranked = scoreDrop(players, context({ itemKey: "Ring" }));
    expect(ranked[0]?.player.name).toBe("BothRings");
    expect(ranked[0]?.breakdown.effectiveNeed).toBe(2);
    expect(ranked[1]?.breakdown.effectiveNeed).toBe(1);
  });

  it("breaks ties using the oldest 'last drop' from the floor", () => {
    const base = {
      gearRole: "tank" as const,
      bisDesired: { Earring: "Savage" } as Partial<Record<Slot, BisSource>>,
      bisCurrent: { Earring: "NotPlanned" } as Partial<Record<Slot, BisSource>>,
    };
    const players = [
      makePlayer({
        id: 1,
        name: "Recent",
        ...base,
        lastDropWeekByFloor: { 1: 3 },
      }),
      makePlayer({
        id: 2,
        name: "Patient",
        ...base,
        lastDropWeekByFloor: { 1: 1 },
      }),
    ];
    const ranked = scoreDrop(players, context({ currentWeek: 10 }));
    expect(ranked[0]?.player.name).toBe("Patient");
  });
});

describe("scoreDrop — materials", () => {
  it("prioritises the player who needs more Glaze", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "FourSlots",
        gearRole: "caster",
        bisDesired: {
          Earring: "TomeUp",
          Necklace: "TomeUp",
          Bracelet: "TomeUp",
          Ring1: "TomeUp",
        },
        materialsReceived: { Glaze: 0 },
      }),
      makePlayer({
        id: 2,
        name: "OneSlot",
        gearRole: "caster",
        bisDesired: { Earring: "TomeUp" },
        materialsReceived: { Glaze: 0 },
      }),
    ];
    const ranked = scoreDrop(
      players,
      context({ itemKey: "Glaze", floorNumber: 2 }),
    );
    expect(ranked[0]?.player.name).toBe("FourSlots");
    expect(ranked[0]?.breakdown.effectiveNeed).toBe(4);
    expect(ranked[1]?.breakdown.effectiveNeed).toBe(1);
  });

  it("zeroes the score for a player who already received enough Glaze", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "Saturated",
        gearRole: "caster",
        bisDesired: { Earring: "TomeUp", Necklace: "TomeUp" },
        materialsReceived: { Glaze: 2 },
      }),
    ];
    const [only] = scoreDrop(
      players,
      context({ itemKey: "Glaze", floorNumber: 2 }),
    );
    expect(only?.score).toBe(0);
    expect(only?.breakdown.effectiveNeed).toBe(0);
  });

  it("considers Floor 2 pages when computing buy power for Glaze", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "PageRich",
        gearRole: "caster",
        bisDesired: { Earring: "TomeUp" },
        materialsReceived: {},
        pages: { 2: 6 }, // 6 / 3 = 2 — can buy two Glazes already
      }),
    ];
    const [only] = scoreDrop(
      players,
      context({ itemKey: "Glaze", floorNumber: 2 }),
    );
    expect(only?.breakdown.buyPower).toBe(2);
    expect(only?.score).toBe(0);
  });

  it("does not apply role weights to materials (default 1.00)", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "Caster",
        gearRole: "caster",
        bisDesired: { Head: "TomeUp" },
      }),
      makePlayer({
        id: 2,
        name: "Melee",
        gearRole: "melee",
        bisDesired: { Head: "TomeUp" },
      }),
    ];
    const [first, second] = scoreDrop(
      players,
      context({ itemKey: "Twine", floorNumber: 3 }),
    );
    expect(first?.score).toBe(second?.score);
    expect(first?.breakdown.roleWeight).toBe(1);
    expect(second?.breakdown.roleWeight).toBe(1);
  });
});
