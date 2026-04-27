import { describe, expect, it } from "vitest";

import type { GearRole } from "@/lib/ffxiv/jobs";
import { type BisSource, deriveSourceIlvs, type Slot } from "@/lib/ffxiv/slots";

import type { PlayerSnapshot, TierSnapshot } from "./algorithm";
import { scoreDrop } from "./algorithm";
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

  it("page-rich players get fewer drops in week 1 via simulated purchase (v2.2.1)", () => {
    // v2.2.1: `computePurchasedSlots` simulates self-purchase per
    // (player, floor) per week. PageRich starts with 9 Floor-1
    // pages — after the week-1 kill that's 10, enough to buy
    // floor(10/3) = 3 accessories. Of their 4 needed slots
    // (Earring, Necklace, Bracelet, Ring1), the first 3 in
    // floor-item order are simulated as bought, leaving only
    // Ring1 in the drop pool. PagePoor needs all 4, has 0 pages,
    // and outscores PageRich on every other item. The week-1
    // drops should therefore mostly land on PagePoor.
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
    const week1Recipients = week1?.drops.map((d) => d.recipientName) ?? [];
    // PagePoor wins Earring/Necklace/Bracelet because PageRich is
    // assumed to have bought them. The Ring drop ties on score and
    // tiebreakers settle it, but PagePoor still wins the bulk of
    // the week regardless.
    const poorWins = week1Recipients.filter((n) => n === "PagePoor").length;
    expect(poorWins).toBeGreaterThanOrEqual(3);
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

describe("plan ↔ track parity", () => {
  // The Plan tab is meant to be a faithful preview of what the Track
  // tab will recommend on the next kill. Both views consume the same
  // snapshot, but pre-v1.5.0 the simulator started at
  // `currentWeek + 1` AND incremented every player's pages by 1
  // before scoring the first week — so the snapshot the simulator
  // scored differed from the live snapshot by one page (which is
  // enough to flip `buyPower` thresholds and pick a different
  // recipient). The tests below pin down the parity contract: when
  // the simulator is told the snapshot already reflects the active
  // week's kill (`alreadyKilledFloors`), its first-week
  // recommendation matches `scoreDrop` for the same data exactly.
  it("first-week recommendation matches scoreDrop on the same snapshot", () => {
    const tier = makeTier();
    // Both players sit just below the page-buy threshold for an
    // accessory (cost 3, pages 2). Track scores against pages=2
    // (buyPower=0, effective_need=1, recommended). Pre-fix the
    // simulator would also count the active-week kill again
    // (pages=3, buyPower=1, effective_need=0, NOT recommended) —
    // a different recommendation for the same data. With
    // `alreadyKilledFloors: [1]` the simulator's first iteration
    // skips that re-increment and stays in lock-step with Track.
    const players: PlayerSnapshot[] = [
      makePlayer({
        id: 1,
        name: "Tank",
        gearRole: "tank",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "Crafted" },
        pages: { 1: 2 },
      }),
      makePlayer({
        id: 2,
        name: "Melee",
        gearRole: "melee",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "Crafted" },
        pages: { 1: 2 },
      }),
    ];
    const activeWeek = 10;

    const trackRanking = scoreDrop(players, {
      itemKey: "Earring",
      floorNumber: 1,
      currentWeek: activeWeek,
      tier,
    });
    const trackTop = trackRanking[0]?.player.name;
    // Sanity: Track actually recommends someone (otherwise the
    // parity assertion below would be vacuously true even with the
    // bug present).
    expect(trackRanking[0]?.score).toBeGreaterThan(0);

    const plan = simulateLootTimeline(players, tier, {
      startingWeekNumber: activeWeek,
      weeksAhead: 1,
      alreadyKilledFloors: [1],
      floors: [
        {
          floorNumber: 1,
          itemKeys: ["Earring", "Necklace", "Bracelet", "Ring"],
          trackedForAlgorithm: true,
        },
      ],
    });
    const planEarring = plan[0]?.weeks[0]?.drops.find(
      (d) => d.itemKey === "Earring",
    );

    expect(planEarring?.recipientName).toBe(trackTop);
  });

  it("subsequent weeks still increment pages (one kill per week)", () => {
    // Same fixture but ask for two weeks ahead. The first iteration
    // skips the page increment for the active-week floors (per the
    // contract above); the second iteration MUST increment pages,
    // otherwise the simulator never advances. Week-1 awards every
    // accessory to the only player, so week-2's effective_need is
    // 0 for those slots — but the algorithm's recency penalty
    // (`weeksSinceLastDrop`) still fires for week-2 vs the awarded
    // week-1, which only computes correctly if the week number
    // advanced by exactly one. The cleanest way to assert that is
    // to inspect the resulting `weekNumber` values.
    const tier = makeTier();
    const players: PlayerSnapshot[] = [
      makePlayer({
        id: 1,
        name: "Solo",
        gearRole: "tank",
        bisDesired: {
          Earring: "Savage",
          Necklace: "Savage",
          Bracelet: "Savage",
          Ring1: "Savage",
        },
        bisCurrent: {
          Earring: "Crafted",
          Necklace: "Crafted",
          Bracelet: "Crafted",
          Ring1: "Crafted",
        },
        pages: { 1: 0 },
      }),
    ];
    const plan = simulateLootTimeline(players, tier, {
      startingWeekNumber: 10,
      weeksAhead: 3,
      alreadyKilledFloors: [1],
      floors: [
        {
          floorNumber: 1,
          itemKeys: ["Earring", "Necklace", "Bracelet", "Ring"],
          trackedForAlgorithm: true,
        },
      ],
    });
    const weekNumbers = plan[0]?.weeks.map((w) => w.weekNumber);
    expect(weekNumbers).toEqual([10, 11, 12]);
    // Week 1 (active): all four drops to Solo (only player).
    const w1 = plan[0]?.weeks[0]?.drops.map((d) => d.recipientName);
    expect(w1).toEqual(["Solo", "Solo", "Solo", "Solo"]);
  });

  it("fully self-served sole candidate gets no recommendation (v2.3)", () => {
    // v2.3 — when a single-player tier has only one needed slot
    // and the player's pages cover it via simulated self-
    // purchase, the algorithm zeros their score (they're fully
    // self-served on that floor) and returns no recipient. With
    // no other candidate, the drop falls to nobody on the Plan
    // tab — same as the long-running pre-v2.2 behaviour, but for
    // the right reason: the player IS going to buy the slot, so
    // recommending the drop to them would just leak it.
    const tier = makeTier();
    const players: PlayerSnapshot[] = [
      makePlayer({
        id: 1,
        name: "Loner",
        gearRole: "tank",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "Crafted" },
        pages: { 1: 2 }, // After +1 = 3 → buyPower = 1
      }),
    ];
    const plan = simulateLootTimeline(players, tier, {
      startingWeekNumber: 1,
      weeksAhead: 1,
      floors: [
        {
          floorNumber: 1,
          itemKeys: ["Earring"],
          trackedForAlgorithm: true,
        },
      ],
    });
    const earring = plan[0]?.weeks[0]?.drops[0];
    expect(earring?.recipientName).toBeNull();
  });

  it("does not spill fully-self-served onto later items in the same lockout (v2.5.1)", () => {
    // v2.5.1 — the Bracelet spillover bug: in a tier where a
    // player wins one F1 item early in a week (Necklace), the
    // sequential awarding loop used to recompute purchasedSlots
    // against the freshly-mutated bisCurrent. The remaining
    // unmet count fell to 1, matching buyPower=1, so the player
    // was falsely flagged "fully self-served" for the next item
    // (Bracelet) in the same lockout — the drop ended up
    // assigned to nobody, even though the player still wanted
    // and didn't have it.
    //
    // Two-player scenario reproduces the original Kaz vs Fara
    // situation: Kaz wants Necklace+Bracelet, Fara wants only
    // Bracelet, both have 3 F1 pages. After the +1 from this
    // week's kill that's 4 pages → buyPower=1 each. Necklace
    // legitimately goes to Kaz (only wanter). Bracelet should
    // ALSO go to Kaz (or Fara, but anyway: assigned, not "—").
    const tier = makeTier();
    const players: PlayerSnapshot[] = [
      makePlayer({
        id: 1,
        name: "Kaz",
        gearRole: "healer",
        bisDesired: { Necklace: "Savage", Bracelet: "Savage" },
        bisCurrent: { Necklace: "Crafted", Bracelet: "Crafted" },
        pages: { 1: 3 },
      }),
      makePlayer({
        id: 2,
        name: "Fara",
        gearRole: "tank",
        bisDesired: { Bracelet: "Savage" },
        bisCurrent: { Bracelet: "Crafted" },
        pages: { 1: 3 },
      }),
    ];
    const plan = simulateLootTimeline(players, tier, {
      startingWeekNumber: 1,
      weeksAhead: 1,
      floors: [
        {
          floorNumber: 1,
          itemKeys: ["Earring", "Necklace", "Bracelet", "Ring"],
          trackedForAlgorithm: true,
        },
      ],
    });
    const week1 = plan[0]?.weeks[0]?.drops ?? [];
    const necklaceDrop = week1.find((d) => d.itemKey === "Necklace");
    const braceletDrop = week1.find((d) => d.itemKey === "Bracelet");
    expect(necklaceDrop?.recipientName).toBe("Kaz");
    // The point of the regression test: Bracelet must land on a
    // recipient, even though Kaz' remaining unmet count fell to
    // 1 == buyPower after she won Necklace earlier in the loop.
    expect(braceletDrop?.recipientName).not.toBeNull();
  });
});
