import { describe, expect, it } from "vitest";

import type { GearRole } from "@/lib/ffxiv/jobs";
import { type BisSource, deriveSourceIlvs, type Slot } from "@/lib/ffxiv/slots";

import type { PlayerSnapshot, TierSnapshot } from "./algorithm";
import { computeFloorPlan } from "./floor-planner";

/**
 * Min-cost-flow floor planner tests.
 *
 * Tests are scenario-driven: a small named situation, a call to
 * `computeFloorPlan`, and assertions about the produced drops +
 * buys. The actual flow algorithm is exercised in `mcmf.test.ts`;
 * here we pin the loot-specific wiring (which slots count as
 * needs, how pages translate to buy capacity, how items map to
 * slots).
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
  savageDropsThisTier?: number;
  lastDropWeekByFloor?: Partial<Record<number, number | null>>;
}

function makePlayer(opts: PlayerOptions): PlayerSnapshot {
  return {
    id: opts.id,
    name: opts.name,
    gearRole: opts.gearRole,
    bisDesired: new Map(Object.entries(opts.bisDesired ?? {})) as Map<
      Slot,
      BisSource
    >,
    bisCurrent: new Map(Object.entries(opts.bisCurrent ?? {})) as Map<
      Slot,
      BisSource
    >,
    pages: new Map(
      Object.entries(opts.pages ?? {}).map(([k, v]) => [Number(k), v ?? 0]),
    ),
    materialsReceived: new Map(),
    savageDropsThisTier: opts.savageDropsThisTier ?? 0,
    lastDropWeekByFloor: new Map(
      Object.entries(opts.lastDropWeekByFloor ?? {}).map(([k, v]) => [
        Number(k),
        v ?? null,
      ]),
    ),
  };
}

const FLOOR_1 = {
  floorNumber: 1,
  itemKeys: ["Earring", "Necklace", "Bracelet", "Ring"] as Array<
    "Earring" | "Necklace" | "Bracelet" | "Ring"
  >,
  trackedForAlgorithm: true,
};

describe("computeFloorPlan", () => {
  it("returns the floor's metadata + week list with no drops when there are no players", () => {
    const plan = computeFloorPlan(FLOOR_1, [], makeTier(), {
      startingWeekNumber: 1,
      weeksAhead: 3,
      alreadyKilledFloors: new Set(),
    });
    expect(plan.floorNumber).toBe(1);
    expect(plan.tracked).toBe(true);
    expect(plan.weekNumbers).toEqual([1, 2, 3]);
    expect(plan.drops).toHaveLength(0);
    expect(plan.buys).toHaveLength(0);
    expect(plan.unassignedDrops).toHaveLength(12); // 4 items × 3 weeks
  });

  it("untracked floors emit drops as unassigned without consulting players", () => {
    const plan = computeFloorPlan(
      { floorNumber: 4, itemKeys: ["Weapon"], trackedForAlgorithm: false },
      [
        makePlayer({
          id: 1,
          name: "P",
          gearRole: "tank",
          bisDesired: { Weapon: "Savage" },
          bisCurrent: { Weapon: "Crafted" },
        }),
      ],
      makeTier(),
      {
        startingWeekNumber: 1,
        weeksAhead: 2,
        alreadyKilledFloors: new Set(),
      },
    );
    expect(plan.tracked).toBe(false);
    expect(plan.drops).toHaveLength(0);
    expect(plan.buys).toHaveLength(0);
    expect(plan.unassignedDrops).toHaveLength(2);
  });

  it("assigns the only drop to the only wanting player", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "Solo",
        gearRole: "tank",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "Crafted" },
      }),
    ];
    const plan = computeFloorPlan(FLOOR_1, players, makeTier(), {
      startingWeekNumber: 1,
      weeksAhead: 1,
      alreadyKilledFloors: new Set(),
    });
    const earringDrop = plan.drops.find((d) => d.itemKey === "Earring");
    expect(earringDrop).toBeDefined();
    expect(earringDrop?.recipientName).toBe("Solo");
    expect(earringDrop?.slot).toBe("Earring");
  });

  it("does not assign drops to players who don't want the matching slot", () => {
    const players = [
      makePlayer({
        id: 1,
        name: "WantsRing",
        gearRole: "tank",
        bisDesired: { Ring1: "Savage" },
        bisCurrent: { Ring1: "Crafted" },
      }),
    ];
    const plan = computeFloorPlan(FLOOR_1, players, makeTier(), {
      startingWeekNumber: 1,
      weeksAhead: 1,
      alreadyKilledFloors: new Set(),
    });
    const earringDrop = plan.drops.find((d) => d.itemKey === "Earring");
    expect(earringDrop).toBeUndefined();
    const ringDrop = plan.drops.find((d) => d.itemKey === "Ring");
    expect(ringDrop?.recipientName).toBe("WantsRing");
    expect(ringDrop?.slot).toBe("Ring1");
  });

  it("does NOT spill fully-served onto later items in the same lockout (Bracelet regression)", () => {
    // The bug from v2.5.1: a player who wins one floor item early
    // in a week was falsely marked "fully self-served" for the
    // next item in the same lockout because the greedy simulator
    // re-computed `purchasedSlots` against the already-mutated
    // bisCurrent. The min-cost-flow planner avoids this by
    // construction — every item in the floor is assigned in a
    // single solve, no sequential mutation.
    //
    // Reproducer: Kaz wants Necklace + Bracelet, Fara wants only
    // Bracelet, both have 3 F1 pages. After +1 from this week's
    // kill that's 4 pages → buyPower=1 each. Necklace MUST go to
    // Kaz (only wanter); Bracelet must NOT vanish into "—".
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
    const plan = computeFloorPlan(FLOOR_1, players, tier, {
      startingWeekNumber: 1,
      weeksAhead: 1,
      alreadyKilledFloors: new Set(),
    });
    const necklaceDrop = plan.drops.find((d) => d.itemKey === "Necklace");
    const braceletDrop = plan.drops.find((d) => d.itemKey === "Bracelet");
    expect(necklaceDrop?.recipientName).toBe("Kaz");
    // The point: Bracelet must be assigned, not "—".
    expect(braceletDrop).toBeDefined();
    expect(["Kaz", "Fara"]).toContain(braceletDrop?.recipientName);
  });

  it("emits a buy plan when drops alone can't cover a player's needs in the horizon", () => {
    // Two players, both need an Earring and a Bracelet. Only one
    // of each drops in the 4-week horizon → one of them needs to
    // self-buy at least one slot.
    const players = [
      makePlayer({
        id: 1,
        name: "A",
        gearRole: "tank",
        bisDesired: { Earring: "Savage", Bracelet: "Savage" },
        bisCurrent: {
          Earring: "Crafted",
          Bracelet: "Crafted",
        },
      }),
      makePlayer({
        id: 2,
        name: "B",
        gearRole: "healer",
        bisDesired: { Earring: "Savage", Bracelet: "Savage" },
        bisCurrent: {
          Earring: "Crafted",
          Bracelet: "Crafted",
        },
      }),
    ];
    const plan = computeFloorPlan(
      {
        ...FLOOR_1,
        // Only 2 items per week so drops can't cover all 4 needs
        // (2 players × 2 slots) within reach.
        itemKeys: ["Earring", "Bracelet"],
      },
      players,
      makeTier(),
      {
        startingWeekNumber: 1,
        weeksAhead: 4,
        alreadyKilledFloors: new Set(),
      },
    );
    // Total drops + buys should cover all 4 (player, slot) needs.
    expect(plan.drops.length + plan.buys.length).toBe(4);
    // Each (player, slot) pair appears exactly once across drops+buys.
    const filled = new Set<string>();
    for (const d of plan.drops) {
      filled.add(`${d.recipientId}|${d.slot}`);
    }
    for (const b of plan.buys) {
      filled.add(`${b.playerId}|${b.slot}`);
    }
    expect(filled.size).toBe(4);
  });

  it("respects already-killed floors when computing buy completion weeks", () => {
    const tier = makeTier();
    const player = makePlayer({
      id: 1,
      name: "P",
      gearRole: "tank",
      bisDesired: { Earring: "Savage" },
      bisCurrent: { Earring: "Crafted" },
      pages: { 1: 2 }, // need +1 from a kill to afford 1 buy at cost=3
    });

    // No kill yet this week → +1 from W1 kill → 3 pages → can buy
    // at completion week == startingWeekNumber.
    const planFresh = computeFloorPlan(FLOOR_1, [player], tier, {
      startingWeekNumber: 5,
      weeksAhead: 4,
      alreadyKilledFloors: new Set(),
    });
    // Drop preferred over buy when cost-tied; player wants 1 slot
    // and 4 weeks of drops are available, so a drop wins.
    expect(planFresh.drops.find((d) => d.recipientName === "P")).toBeDefined();
    expect(planFresh.buys).toHaveLength(0);

    // Already-killed = page balance is "as-is", no +1 increment.
    // With 2 pages and cost 3, buy is feasible at week 5+1 = 6.
    // Drop still wins (cheaper week-cost), so no buy emitted —
    // but the network construction should not crash and the drop
    // must still come through.
    const planKilled = computeFloorPlan(FLOOR_1, [player], tier, {
      startingWeekNumber: 5,
      weeksAhead: 4,
      alreadyKilledFloors: new Set([1]),
    });
    expect(planKilled.drops.find((d) => d.recipientName === "P")).toBeDefined();
  });

  it("min-max distributes drops fairly (no role weight bias)", () => {
    // Both players want all 4 F1 Savage slots. With 4 drops in
    // W1 and a melee-vs-caster mix, the v2 algorithm would have
    // given more drops to melee due to ROLE_WEIGHTS. The v3
    // min-max-time-to-BiS objective treats roles equally — both
    // players should end up with the same number of drops + buys
    // covering all of their needs.
    const players = [
      makePlayer({
        id: 1,
        name: "Melee",
        gearRole: "melee",
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
      }),
      makePlayer({
        id: 2,
        name: "Caster",
        gearRole: "caster",
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
      }),
    ];
    const plan = computeFloorPlan(FLOOR_1, players, makeTier(), {
      startingWeekNumber: 1,
      weeksAhead: 8,
      alreadyKilledFloors: new Set(),
    });
    const meleeFulfilments =
      plan.drops.filter((d) => d.recipientName === "Melee").length +
      plan.buys.filter((b) => b.playerName === "Melee").length;
    const casterFulfilments =
      plan.drops.filter((d) => d.recipientName === "Caster").length +
      plan.buys.filter((b) => b.playerName === "Caster").length;
    // Each player wants 4 Savage slots; min-max should serve each.
    expect(meleeFulfilments).toBe(4);
    expect(casterFulfilments).toBe(4);
  });

  it("plans Glaze drops + buys to fill TomeUp accessory needs (v3.1 materials)", () => {
    // F2 drops Glaze (cost 3). With 4 players each wanting 3
    // accessory TomeUp slots = 12 needs total, but only 8 Glaze
    // drops in the horizon, the optimiser must mix drops with
    // page-buys so every player ends up covered.
    const tier = makeTier();
    const players: PlayerSnapshot[] = ["A", "B", "C", "D"].map((name, idx) =>
      makePlayer({
        id: idx + 1,
        name,
        gearRole: "tank",
        bisDesired: {
          Earring: "TomeUp",
          Necklace: "TomeUp",
          Bracelet: "TomeUp",
        },
        bisCurrent: {
          Earring: "Crafted",
          Necklace: "Crafted",
          Bracelet: "Crafted",
        },
      }),
    );
    const plan = computeFloorPlan(
      {
        floorNumber: 2,
        itemKeys: ["Head", "Gloves", "Boots", "Glaze"],
        trackedForAlgorithm: true,
      },
      players,
      tier,
      {
        startingWeekNumber: 1,
        weeksAhead: 8,
        alreadyKilledFloors: new Set(),
      },
    );
    const totalFulfilments =
      plan.drops.filter((d) => d.source === "TomeUp").length +
      plan.buys.filter((b) => b.source === "TomeUp").length;
    // 4 players × 3 accessory needs each = 12 TomeUp fills total.
    expect(totalFulfilments).toBe(12);
    // At least one Glaze drop assigned (drops cheaper than buys).
    expect(
      plan.drops.some((d) => d.itemKey === "Glaze" && d.source === "TomeUp"),
    ).toBe(true);
    // At least one Glaze buy assigned to cover the deficit
    // (only 8 Glaze drops in the horizon vs 12 needs).
    expect(
      plan.buys.some((b) => b.itemKey === "Glaze" && b.source === "TomeUp"),
    ).toBe(true);
  });

  it("respects shared page budget across cost classes (F2 Glaze + gear)", () => {
    // F2 has Glaze (cost 3) and gear (cost 4). With 8 pages
    // total a player can buy at most 2 items if mixing: 1 Glaze
    // (3) + 1 gear (4) = 7 pages, leaves 1 unused. The model
    // must not over-allocate buys: total pagesUsed ≤ totalPages.
    const tier = makeTier();
    const players = [
      makePlayer({
        id: 1,
        name: "Mixed",
        gearRole: "tank",
        bisDesired: {
          Head: "Savage",
          Gloves: "Savage",
          Boots: "Savage",
          Earring: "TomeUp",
          Necklace: "TomeUp",
          Bracelet: "TomeUp",
        },
        bisCurrent: {
          Head: "Crafted",
          Gloves: "Crafted",
          Boots: "Crafted",
          Earring: "Crafted",
          Necklace: "Crafted",
          Bracelet: "Crafted",
        },
      }),
    ];
    const plan = computeFloorPlan(
      {
        floorNumber: 2,
        itemKeys: ["Head", "Gloves", "Boots", "Glaze"],
        trackedForAlgorithm: true,
      },
      players,
      tier,
      {
        startingWeekNumber: 1,
        weeksAhead: 8,
        alreadyKilledFloors: new Set(),
      },
    );
    const totalPages = plan.buys
      .filter((b) => b.playerName === "Mixed")
      .reduce((sum, b) => sum + b.pagesUsed, 0);
    // Mixed player has 8 F2 pages over the horizon; total spend
    // must not exceed that.
    expect(totalPages).toBeLessThanOrEqual(8);
  });

  it("Twine drops on F3 fill clothing TomeUp needs (v3.1 materials)", () => {
    const tier = makeTier();
    const players = [
      makePlayer({
        id: 1,
        name: "Solo",
        gearRole: "caster",
        bisDesired: { Head: "TomeUp", Pants: "TomeUp" },
        bisCurrent: { Head: "Crafted", Pants: "Crafted" },
      }),
    ];
    const plan = computeFloorPlan(
      {
        floorNumber: 3,
        itemKeys: ["Chestpiece", "Pants", "Twine", "Ester"],
        trackedForAlgorithm: true,
      },
      players,
      tier,
      {
        startingWeekNumber: 1,
        weeksAhead: 8,
        alreadyKilledFloors: new Set(),
      },
    );
    const filled =
      plan.drops.filter((d) => d.source === "TomeUp").length +
      plan.buys.filter((b) => b.source === "TomeUp").length;
    expect(filled).toBe(2);
    // At least one Twine drop assigned (cheaper than buying).
    expect(plan.drops.some((d) => d.itemKey === "Twine")).toBe(true);
  });

  it("v3.3 slot weights bias which slot is filled first when one player needs multiple", () => {
    // Two-week horizon, single player wants Head + Boots; F2
    // drops Head, Gloves, Boots once per week. The optimiser
    // can fill both needs by week 2, but the *order* of fills
    // is steered by slot weights — the cheaper-weight slot
    // should land in the earlier week.
    const tier = makeTier();
    const player = makePlayer({
      id: 1,
      name: "Solo",
      gearRole: "tank",
      bisDesired: { Head: "Savage", Boots: "Savage" },
      bisCurrent: { Head: "Crafted", Boots: "Crafted" },
    });
    const planFavorHead = computeFloorPlan(
      {
        floorNumber: 2,
        itemKeys: ["Head", "Gloves", "Boots"],
        trackedForAlgorithm: true,
      },
      [player],
      tier,
      {
        startingWeekNumber: 1,
        weeksAhead: 2,
        alreadyKilledFloors: new Set(),
        slotWeights: { Head: 0.1, Boots: 2.0 },
      },
    );
    const headDrop = planFavorHead.drops.find((d) => d.itemKey === "Head");
    const bootsDrop = planFavorHead.drops.find((d) => d.itemKey === "Boots");
    expect(headDrop).toBeDefined();
    expect(bootsDrop).toBeDefined();
    // Cheap-weight slot lands in week 1; expensive in week 2.
    expect(headDrop?.week).toBeLessThanOrEqual(bootsDrop?.week ?? Infinity);

    // Flip the weights and the order should flip.
    const planFavorBoots = computeFloorPlan(
      {
        floorNumber: 2,
        itemKeys: ["Head", "Gloves", "Boots"],
        trackedForAlgorithm: true,
      },
      [player],
      tier,
      {
        startingWeekNumber: 1,
        weeksAhead: 2,
        alreadyKilledFloors: new Set(),
        slotWeights: { Head: 2.0, Boots: 0.1 },
      },
    );
    const headDrop2 = planFavorBoots.drops.find((d) => d.itemKey === "Head");
    const bootsDrop2 = planFavorBoots.drops.find((d) => d.itemKey === "Boots");
    expect(bootsDrop2?.week).toBeLessThanOrEqual(headDrop2?.week ?? Infinity);
  });

  it("v3.3 role weights bias drops toward the lighter-weight role on a tie", () => {
    // Two players, both want one Earring, weeksAhead=1 → only
    // a single Earring drops (one of them gets it, the other
    // is left with the buy). With role weights tank=0.1 vs
    // healer=2.0, the drop should land on the tank.
    const tier = makeTier();
    const players = [
      makePlayer({
        id: 1,
        name: "Tank",
        gearRole: "tank",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "Crafted" },
      }),
      makePlayer({
        id: 2,
        name: "Healer",
        gearRole: "healer",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "Crafted" },
      }),
    ];
    const plan = computeFloorPlan(FLOOR_1, players, tier, {
      startingWeekNumber: 1,
      weeksAhead: 1,
      alreadyKilledFloors: new Set(),
      roleWeights: { tank: 0.1, healer: 2.0 },
    });
    const earringDrop = plan.drops.find((d) => d.itemKey === "Earring");
    expect(earringDrop?.recipientName).toBe("Tank");

    // Flip the weights and the drop should go to the healer.
    const planFlipped = computeFloorPlan(FLOOR_1, players, tier, {
      startingWeekNumber: 1,
      weeksAhead: 1,
      alreadyKilledFloors: new Set(),
      roleWeights: { tank: 2.0, healer: 0.1 },
    });
    const earringDrop2 = planFlipped.drops.find((d) => d.itemKey === "Earring");
    expect(earringDrop2?.recipientName).toBe("Healer");
  });
});
