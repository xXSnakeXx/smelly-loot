import { describe, expect, it } from "vitest";

import type { GearRole } from "@/lib/ffxiv/jobs";
import { type BisSource, deriveSourceIlvs, type Slot } from "@/lib/ffxiv/slots";

import type { PlayerSnapshot, TierSnapshot } from "./algorithm";
import { simulateLootTimeline } from "./timeline";

/**
 * Test fixtures.
 *
 * Same shape as `algorithm.test.ts` so the two test files stay easy
 * to compare.
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

const FLOOR1 = {
  floorNumber: 1,
  itemKeys: ["Earring", "Necklace", "Bracelet", "Ring"] as const,
  trackedForAlgorithm: true,
};

const FLOOR1_OPTS = {
  startingWeekNumber: 1,
  weeksAhead: 4,
  floors: [{ ...FLOOR1, itemKeys: [...FLOOR1.itemKeys] }],
};

describe("simulateLootTimeline", () => {
  it("plans a multi-week timeline that's deterministic per input", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "A",
        gearRole: "tank",
        bisDesired: {
          Earring: "Savage",
          Necklace: "Savage",
          Bracelet: "Savage",
          Ring1: "Savage",
        },
      }),
      makePlayer({
        id: 2,
        name: "B",
        gearRole: "melee",
        bisDesired: {
          Earring: "Savage",
          Necklace: "Savage",
          Bracelet: "Savage",
          Ring1: "Savage",
        },
      }),
    ];
    const t1 = simulateLootTimeline(players, makeTier(), FLOOR1_OPTS);
    const t2 = simulateLootTimeline(players, makeTier(), FLOOR1_OPTS);
    expect(t1).toEqual(t2);
  });

  it("does not mutate the caller's snapshots", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "A",
        gearRole: "tank",
        bisDesired: { Earring: "Savage" },
      }),
    ];
    const beforePages = new Map(players[0]?.pages);
    simulateLootTimeline(players, makeTier(), FLOOR1_OPTS);
    expect(players[0]?.pages).toEqual(beforePages);
  });

  it("returns one row per requested floor with weeksAhead entries each", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "A",
        gearRole: "tank",
        bisDesired: { Earring: "Savage" },
      }),
    ];
    const result = simulateLootTimeline(players, makeTier(), {
      startingWeekNumber: 5,
      weeksAhead: 6,
      floors: [{ ...FLOOR1, itemKeys: [...FLOOR1.itemKeys] }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.floorNumber).toBe(1);
    expect(result[0]?.weeks).toHaveLength(6);
    expect(result[0]?.weeks[0]?.weekNumber).toBe(5);
    expect(result[0]?.weeks[5]?.weekNumber).toBe(10);
  });

  it("rotates the recipient as their need decreases over weeks", () => {
    // Two players, each wanting two accessories from Savage. The
    // top scorer should win week 1; once they have one of their two
    // slots, the other player's score climbs (fewer drops received,
    // smaller fairness penalty), so they should win at least one
    // drop within the four weeks.
    const players = [
      makePlayer({
        id: 1,
        name: "Quah",
        gearRole: "melee",
        bisDesired: { Earring: "Savage", Necklace: "Savage" },
      }),
      makePlayer({
        id: 2,
        name: "Rei",
        gearRole: "phys_range",
        bisDesired: { Earring: "Savage", Necklace: "Savage" },
      }),
    ];
    const result = simulateLootTimeline(players, makeTier(), FLOOR1_OPTS);
    const recipients = result[0]?.weeks
      .flatMap((w) => w.drops.map((d) => d.recipientName))
      .filter((name): name is string => name !== null);
    expect(new Set(recipients).has("Quah")).toBe(true);
    expect(new Set(recipients).has("Rei")).toBe(true);
  });

  it("page-aware timeline: a player who can self-buy is skipped early on", () => {
    // PageRich starts with 9 floor-1 pages — enough to buy 3
    // accessories — so the algorithm shouldn't recommend them for
    // their first three needed drops in any of the early weeks.
    const players = [
      makePlayer({
        id: 1,
        name: "PageRich",
        gearRole: "melee",
        bisDesired: {
          Earring: "Savage",
          Necklace: "Savage",
          Bracelet: "Savage",
          Ring1: "Savage",
        },
        pages: { 1: 9 },
      }),
      makePlayer({
        id: 2,
        name: "PagePoor",
        gearRole: "melee",
        bisDesired: {
          Earring: "Savage",
          Necklace: "Savage",
          Bracelet: "Savage",
          Ring1: "Savage",
        },
        pages: { 1: 0 },
      }),
    ];
    const result = simulateLootTimeline(players, makeTier(), {
      ...FLOOR1_OPTS,
      weeksAhead: 1,
    });
    const week1 = result[0]?.weeks[0];
    expect(week1).toBeDefined();
    // PagePoor should win all four week-1 drops.
    const week1Recipients = week1?.drops.map((d) => d.recipientName) ?? [];
    expect(week1Recipients.every((n) => n === "PagePoor")).toBe(true);
  });

  it("untracked floors are listed but never assign a recipient", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "A",
        gearRole: "tank",
        bisDesired: { Weapon: "Savage" },
      }),
    ];
    const result = simulateLootTimeline(players, makeTier(), {
      startingWeekNumber: 1,
      weeksAhead: 2,
      floors: [
        {
          floorNumber: 4,
          itemKeys: ["Weapon"],
          trackedForAlgorithm: false,
        },
      ],
    });
    const floor4 = result[0];
    expect(floor4?.tracked).toBe(false);
    for (const week of floor4?.weeks ?? []) {
      for (const drop of week.drops) {
        expect(drop.recipientId).toBeNull();
      }
    }
  });
});
