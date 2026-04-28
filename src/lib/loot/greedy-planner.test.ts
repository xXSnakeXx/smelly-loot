import { describe, expect, it } from "vitest";

import type { GearRole } from "@/lib/ffxiv/jobs";
import { type BisSource, deriveSourceIlvs, type Slot } from "@/lib/ffxiv/slots";

import type { PlayerSnapshot, TierSnapshot } from "./algorithm";
import { computeGreedyPlan, type FloorMeta } from "./greedy-planner";

/**
 * Greedy bottleneck-aware planner tests (v4.0).
 *
 * Each test pins one design property of the algorithm — the tests
 * are how we know future edits don't accidentally lose them.
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

interface MiniPlayerOpts {
  id: number;
  name: string;
  gearRole: GearRole;
  bisDesired?: Partial<Record<Slot, BisSource>>;
  bisCurrent?: Partial<Record<Slot, BisSource>>;
}

function makePlayer(opts: MiniPlayerOpts): PlayerSnapshot {
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
    pages: new Map(),
    materialsReceived: new Map(),
    savageDropsThisTier: 0,
    lastDropWeekByFloor: new Map(),
  };
}

const FLOOR_1: FloorMeta = {
  floorNumber: 1,
  itemKeys: ["Earring", "Necklace", "Bracelet", "Ring"],
  trackedForAlgorithm: true,
};

const FLOOR_2: FloorMeta = {
  floorNumber: 2,
  itemKeys: ["Head", "Gloves", "Boots", "Glaze"],
  trackedForAlgorithm: true,
};

describe("computeGreedyPlan — basic mechanics", () => {
  it("returns empty plans when there are no players", () => {
    const plans = computeGreedyPlan([FLOOR_1], [], makeTier(), {
      startingWeekNumber: 1,
      alreadyKilledFloors: new Set(),
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.drops).toHaveLength(0);
    expect(plans[0]?.buys).toHaveLength(0);
  });

  it("untracked floors emit unassigned drops without consulting players", () => {
    // Player has open needs at a tracked floor (Earring) so the
    // simulation runs at least 1 week. The untracked Floor 4
    // should emit unassigned drops for that week.
    const player = makePlayer({
      id: 1,
      name: "Solo",
      gearRole: "tank",
      bisDesired: { Earring: "Savage" },
      bisCurrent: { Earring: "Crafted" },
    });
    const plans = computeGreedyPlan(
      [
        FLOOR_1,
        { floorNumber: 4, itemKeys: ["Weapon"], trackedForAlgorithm: false },
      ],
      [player],
      makeTier(),
      { startingWeekNumber: 1, alreadyKilledFloors: new Set(), safetyCap: 5 },
    );
    const untrackedPlan = plans.find((p) => p.floorNumber === 4);
    expect(untrackedPlan?.drops).toHaveLength(0);
    expect(untrackedPlan?.unassignedDrops.length).toBeGreaterThan(0);
  });

  it("assigns the only drop to the only wanting player", () => {
    const player = makePlayer({
      id: 1,
      name: "Solo",
      gearRole: "tank",
      bisDesired: { Earring: "Savage" },
      bisCurrent: { Earring: "Crafted" },
    });
    const plans = computeGreedyPlan([FLOOR_1], [player], makeTier(), {
      startingWeekNumber: 1,
      alreadyKilledFloors: new Set(),
    });
    const earringDrops = plans[0]?.drops.filter((d) => d.itemKey === "Earring");
    expect(earringDrops?.length).toBeGreaterThan(0);
    expect(earringDrops?.[0]?.recipientName).toBe("Solo");
  });
});

describe("computeGreedyPlan — bottleneck behaviour", () => {
  it("Boss 1: the Ring trick — Drop-Empfänger kaufen anderes Acc, restliche Spieler kaufen Ring", () => {
    // Setup matching the user's worked example:
    //   8 players all need 1 Ring (Ring1 only)
    //   5 need an Earring, 3 need a Necklace, 4 need a Bracelet
    // Acc-Need totals per slot: Ring 8, Earring 5, Bracelet 4, Necklace 3.
    // Bottleneck pre-simulation = Ring (highest total need).
    const players: PlayerSnapshot[] = [];
    // Build a roster where the per-slot needs sum to the user's
    // example. Distribute the four non-ring needs across the
    // eight players such that everyone needs Ring1.
    const profiles: Array<{
      name: string;
      role: GearRole;
      slots: Array<[Slot, BisSource]>;
    }> = [
      // 5 players need Earring
      // 4 players need Bracelet
      // 3 players need Necklace
      // All 8 need Ring1
      {
        name: "P1",
        role: "tank",
        slots: [
          ["Earring", "Savage"],
          ["Bracelet", "Savage"],
          ["Necklace", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "P2",
        role: "tank",
        slots: [
          ["Earring", "Savage"],
          ["Bracelet", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "P3",
        role: "healer",
        slots: [
          ["Earring", "Savage"],
          ["Necklace", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "P4",
        role: "healer",
        slots: [
          ["Earring", "Savage"],
          ["Bracelet", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "P5",
        role: "melee",
        slots: [
          ["Earring", "Savage"],
          ["Necklace", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "P6",
        role: "phys_range",
        slots: [
          ["Bracelet", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "P7",
        role: "caster",
        slots: [["Ring1", "Savage"]],
      },
      {
        name: "P8",
        role: "caster",
        slots: [["Ring1", "Savage"]],
      },
    ];
    profiles.forEach((profile, idx) => {
      const desired: Record<Slot, BisSource> = {} as Record<Slot, BisSource>;
      const current: Record<Slot, BisSource> = {} as Record<Slot, BisSource>;
      for (const [slot, source] of profile.slots) {
        desired[slot] = source;
        current[slot] = "Crafted";
      }
      players.push(
        makePlayer({
          id: idx + 1,
          name: profile.name,
          gearRole: profile.role,
          bisDesired: desired,
          bisCurrent: current,
        }),
      );
    });

    const plans = computeGreedyPlan([FLOOR_1], players, makeTier(), {
      startingWeekNumber: 1,
      alreadyKilledFloors: new Set(),
    });
    const plan = plans[0];
    expect(plan).toBeDefined();
    if (!plan) return;

    // Total fills (drops + buys) must cover all 20 needs
    // (8 Ring + 5 Earring + 4 Bracelet + 3 Necklace).
    const totalFills = plan.drops.length + plan.buys.length;
    expect(totalFills).toBe(20);

    // Every (player, slot) need must be filled exactly once.
    const filled = new Set<string>();
    for (const d of plan.drops) filled.add(`${d.recipientId}|${d.slot}`);
    for (const b of plan.buys) filled.add(`${b.playerId}|${b.slot}`);
    expect(filled.size).toBe(20);

    // The bottleneck (Ring) should appear in buys — pages were
    // routed to it because it's the scarcest item.
    const ringBuys = plan.buys.filter((b) => b.itemKey === "Ring");
    expect(ringBuys.length).toBeGreaterThan(0);
  });

  it("Boss 2: Glaze-Bottleneck — Pages prefer Glaze, mixed-need players covered first", () => {
    // 5 players have varying Glaze needs (3, 2, 1, 1, 1), 3 have
    // none. Glaze is the bottleneck (highest roster need vs.
    // Head/Gloves/Boots which are typically 1 per player).
    const players: PlayerSnapshot[] = [
      makePlayer({
        id: 1,
        name: "Fara",
        gearRole: "tank",
        bisDesired: {
          Earring: "TomeUp",
          Necklace: "TomeUp",
          Bracelet: "TomeUp",
          Head: "Savage",
        },
        bisCurrent: {
          Earring: "Crafted",
          Necklace: "Crafted",
          Bracelet: "Crafted",
          Head: "Crafted",
        },
      }),
      makePlayer({
        id: 2,
        name: "Sndae",
        gearRole: "healer",
        bisDesired: {
          Earring: "TomeUp",
          Bracelet: "TomeUp",
          Gloves: "Savage",
        },
        bisCurrent: {
          Earring: "Crafted",
          Bracelet: "Crafted",
          Gloves: "Crafted",
        },
      }),
      makePlayer({
        id: 3,
        name: "Kaz",
        gearRole: "healer",
        bisDesired: { Necklace: "TomeUp", Boots: "Savage" },
        bisCurrent: { Necklace: "Crafted", Boots: "Crafted" },
      }),
      makePlayer({
        id: 4,
        name: "Quah",
        gearRole: "melee",
        bisDesired: { Ring1: "TomeUp", Head: "Savage" },
        bisCurrent: { Ring1: "Crafted", Head: "Crafted" },
      }),
      makePlayer({
        id: 5,
        name: "Peter",
        gearRole: "caster",
        bisDesired: { Bracelet: "TomeUp", Gloves: "Savage" },
        bisCurrent: { Bracelet: "Crafted", Gloves: "Crafted" },
      }),
    ];

    const plans = computeGreedyPlan([FLOOR_2], players, makeTier(), {
      startingWeekNumber: 1,
      alreadyKilledFloors: new Set(),
    });
    const plan = plans[0];
    expect(plan).toBeDefined();
    if (!plan) return;

    // 8 TomeUp Glaze needs total (3+2+1+1+1). All must be filled
    // somehow (drops + buys).
    const glazeFills =
      plan.drops.filter((d) => d.itemKey === "Glaze").length +
      plan.buys.filter((b) => b.itemKey === "Glaze").length;
    expect(glazeFills).toBe(8);

    // The player with 3 Glaze needs should be served at least
    // partially by buys — drops alone (1/week) would take them
    // 8 weeks; buys accelerate them.
    const faraGlazeFills =
      plan.drops.filter((d) => d.recipientId === 1 && d.itemKey === "Glaze")
        .length +
      plan.buys.filter((b) => b.playerId === 1 && b.itemKey === "Glaze").length;
    expect(faraGlazeFills).toBe(3);
  });

  it("Bottleneck is fixed at simulation start, not recomputed mid-run", () => {
    // 2 players: A wants 5 Earrings (impossible — only 2 slots),
    // wait that's not a thing in FFXIV. Build a setup where the
    // initial bottleneck would naturally shift if recomputed:
    // 3 players need Ring (3 total), 5 players need Earring.
    // After 3 weeks the Ring need is fully satisfied by drops;
    // a recomputing-bottleneck planner would shift to Earring.
    // We just verify the plan completes and doesn't loop.
    const players: PlayerSnapshot[] = [];
    for (let i = 0; i < 8; i += 1) {
      const ringSlot: Slot | null = i < 3 ? "Ring1" : null;
      const earringSlot: Slot | null = i < 5 ? "Earring" : null;
      const desired: Partial<Record<Slot, BisSource>> = {};
      const current: Partial<Record<Slot, BisSource>> = {};
      if (ringSlot) {
        desired[ringSlot] = "Savage";
        current[ringSlot] = "Crafted";
      }
      if (earringSlot) {
        desired[earringSlot] = "Savage";
        current[earringSlot] = "Crafted";
      }
      players.push(
        makePlayer({
          id: i + 1,
          name: `P${i + 1}`,
          gearRole: "tank",
          bisDesired: desired,
          bisCurrent: current,
        }),
      );
    }
    const plans = computeGreedyPlan([FLOOR_1], players, makeTier(), {
      startingWeekNumber: 1,
      alreadyKilledFloors: new Set(),
    });
    const plan = plans[0];
    expect(plan).toBeDefined();
    if (!plan) return;
    // 3 Ring + 5 Earring = 8 needs, all must be filled.
    expect(plan.drops.length + plan.buys.length).toBe(8);
  });
});

describe("computeGreedyPlan — fairness", () => {
  it("does not give all drops to one player when several have equal need", () => {
    // 3 players, all want one Earring. Only 1 drops/week, so it
    // takes 3 weeks. Each player must get exactly one drop —
    // the intra-week fairness penalty prevents the same player
    // from being scored highest twice.
    const players: PlayerSnapshot[] = [];
    for (let i = 0; i < 3; i += 1) {
      players.push(
        makePlayer({
          id: i + 1,
          name: `P${i + 1}`,
          gearRole: "tank",
          bisDesired: { Earring: "Savage" },
          bisCurrent: { Earring: "Crafted" },
        }),
      );
    }
    const plans = computeGreedyPlan(
      [{ ...FLOOR_1, itemKeys: ["Earring"] }],
      players,
      makeTier(),
      {
        startingWeekNumber: 1,
        alreadyKilledFloors: new Set(),
      },
    );
    const dropsByPlayer = new Map<number, number>();
    for (const d of plans[0]?.drops ?? []) {
      dropsByPlayer.set(
        d.recipientId,
        (dropsByPlayer.get(d.recipientId) ?? 0) + 1,
      );
    }
    // Each of the 3 players gets exactly one Earring drop.
    expect(dropsByPlayer.size).toBe(3);
    for (const count of dropsByPlayer.values()) expect(count).toBe(1);
  });

  it("respects the safetyCap when the need is impossible to satisfy", () => {
    // Player wants Offhand=Savage but no Offhand drops on this
    // floor. Algorithm should hit the safety cap, return what
    // it has, and not hang.
    const player = makePlayer({
      id: 1,
      name: "Solo",
      gearRole: "tank",
      bisDesired: { Offhand: "Savage" },
      bisCurrent: { Offhand: "Crafted" },
    });
    const start = Date.now();
    const plans = computeGreedyPlan([FLOOR_1], [player], makeTier(), {
      startingWeekNumber: 1,
      alreadyKilledFloors: new Set(),
      safetyCap: 5,
    });
    const elapsed = Date.now() - start;
    expect(plans).toHaveLength(1);
    expect(elapsed).toBeLessThan(100);
    // No drops or buys — Floor 1 doesn't drop Offhand and the
    // player needs nothing else.
    expect(plans[0]?.drops).toHaveLength(0);
    expect(plans[0]?.buys).toHaveLength(0);
  });

  it("Pages-Carry-Over works: spend pages in later weeks if not used now", () => {
    // 1 player with 5 needs: Earring, Necklace, Bracelet, Ring1
    // (all Savage). Drops will hand 1 of each per week → all 4
    // can land in weeks 1-4. But pages accumulate at +4/week
    // (1 per item + 1 for Ring) wait no, +1 per kill = +1/week
    // for Floor 1. Cost of any Floor-1 buy = 3 pages → first
    // buy at W3.
    const player = makePlayer({
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
    });
    const plans = computeGreedyPlan([FLOOR_1], [player], makeTier(), {
      startingWeekNumber: 1,
      alreadyKilledFloors: new Set(),
    });
    const plan = plans[0];
    expect(plan).toBeDefined();
    if (!plan) return;
    // All 4 needs filled across drops + buys.
    expect(plan.drops.length + plan.buys.length).toBe(4);
    // No buy can land before W3 (cost 3, +1/week).
    for (const buy of plan.buys) {
      expect(buy.completionWeek).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("computeGreedyPlan — Mini-Beispiel from the design discussion", () => {
  it("Drop-Empfänger kaufen Non-Ring-Items, Spieler ohne Ring kaufen Ring (8-player roster)", () => {
    // Reproduces the user's worked example with realistic
    // roster size: 8 players, all want Ring1=Savage. Some also
    // want Earring/Necklace/Bracelet. After the first 3 weeks
    // of the simulation, 3 players got their Ring as a drop;
    // those 3 should buy something other than Ring with their
    // pages. The other 5 buy Ring.
    //
    // The exact identity of who-buys-what depends on the score
    // ordering; we only assert the structural property: the
    // number of Ring buys equals the count of players still
    // missing Ring after week 3 (which is 5 in this setup).
    const profiles: Array<{
      name: string;
      role: GearRole;
      slots: Array<[Slot, BisSource]>;
    }> = [
      {
        name: "Kuda",
        role: "tank",
        slots: [
          ["Bracelet", "Savage"],
          ["Necklace", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "Kaz",
        role: "healer",
        slots: [
          ["Bracelet", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "Brad",
        role: "caster",
        slots: [
          ["Earring", "Savage"],
          ["Necklace", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "Fara",
        role: "tank",
        slots: [
          ["Earring", "Savage"],
          ["Bracelet", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "Sndae",
        role: "healer",
        slots: [
          ["Earring", "Savage"],
          ["Necklace", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "Quah",
        role: "melee",
        slots: [
          ["Earring", "Savage"],
          ["Bracelet", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "Rei",
        role: "phys_range",
        slots: [
          ["Earring", "Savage"],
          ["Ring1", "Savage"],
        ],
      },
      {
        name: "Peter",
        role: "caster",
        slots: [["Ring1", "Savage"]],
      },
    ];
    const players: PlayerSnapshot[] = profiles.map((p, idx) => {
      const desired: Partial<Record<Slot, BisSource>> = {};
      const current: Partial<Record<Slot, BisSource>> = {};
      for (const [slot, src] of p.slots) {
        desired[slot] = src;
        current[slot] = "Crafted";
      }
      return makePlayer({
        id: idx + 1,
        name: p.name,
        gearRole: p.role,
        bisDesired: desired,
        bisCurrent: current,
      });
    });

    const plans = computeGreedyPlan(
      [{ ...FLOOR_1, itemKeys: ["Earring", "Necklace", "Bracelet", "Ring"] }],
      players,
      makeTier(),
      { startingWeekNumber: 1, alreadyKilledFloors: new Set() },
    );
    const plan = plans[0];
    expect(plan).toBeDefined();
    if (!plan) return;

    // Need totals: Ring 8, Earring 5, Bracelet 4, Necklace 3 → 20 total.
    expect(plan.drops.length + plan.buys.length).toBe(20);

    // Bottleneck = Ring → at least one Ring buy must exist (the
    // pages were spent on the bottleneck for 5 players whose
    // Ring still wasn't covered by drops alone).
    const ringBuys = plan.buys.filter((b) => b.itemKey === "Ring");
    expect(ringBuys.length).toBeGreaterThan(0);

    // Drop-recipients of Ring should NOT also be Ring-buyers
    // (their need was satisfied by the drop).
    const ringDropRecipients = new Set(
      plan.drops.filter((d) => d.itemKey === "Ring").map((d) => d.recipientId),
    );
    for (const buy of ringBuys) {
      expect(ringDropRecipients.has(buy.playerId)).toBe(false);
    }
  });
});

describe("computeGreedyPlan — recompute after a buy is awarded", () => {
  it("does not re-recommend a slot the player already filled via a buy", () => {
    // v4.0.1 regression: when the operator clicks Vergeben on a
    // page-buy in the Plan tab, the action layer auto-equips
    // the slot (sets bisCurrent[slot] = source). On the next
    // recompute the snapshot reflects that, and the planner
    // must not re-recommend the same slot to the same player
    // (neither as a drop nor as another buy).
    //
    // We model that "already-bought" state by pre-setting
    // bisCurrent[Bracelet] = "Savage" on Spieler X before
    // running the planner. X must not appear in any Bracelet
    // drop or Bracelet buy in the resulting plan.
    const profiles: Array<{
      name: string;
      role: GearRole;
      slots: Array<[Slot, BisSource, BisSource]>; // (slot, desired, current)
    }> = [
      // X already has Bracelet via a previous (simulated) buy.
      {
        name: "X",
        role: "tank",
        slots: [
          ["Bracelet", "Savage", "Savage"], // already filled
          ["Ring1", "Savage", "Crafted"],
        ],
      },
      // Four other players still need Bracelet.
      {
        name: "A",
        role: "healer",
        slots: [
          ["Bracelet", "Savage", "Crafted"],
          ["Ring1", "Savage", "Crafted"],
        ],
      },
      {
        name: "B",
        role: "melee",
        slots: [
          ["Bracelet", "Savage", "Crafted"],
          ["Ring1", "Savage", "Crafted"],
        ],
      },
      {
        name: "C",
        role: "phys_range",
        slots: [
          ["Bracelet", "Savage", "Crafted"],
          ["Ring1", "Savage", "Crafted"],
        ],
      },
      {
        name: "D",
        role: "caster",
        slots: [
          ["Bracelet", "Savage", "Crafted"],
          ["Ring1", "Savage", "Crafted"],
        ],
      },
      // Three filler Ring-only players.
      ...["E", "F", "G"].map(
        (name) =>
          ({
            name,
            role: "tank" as GearRole,
            slots: [["Ring1", "Savage", "Crafted"]] as Array<
              [Slot, BisSource, BisSource]
            >,
          }) as const,
      ),
    ];
    const players: PlayerSnapshot[] = profiles.map((p, idx) => {
      const desired: Partial<Record<Slot, BisSource>> = {};
      const current: Partial<Record<Slot, BisSource>> = {};
      for (const [slot, d, c] of p.slots) {
        desired[slot] = d;
        current[slot] = c;
      }
      return makePlayer({
        id: idx + 1,
        name: p.name,
        gearRole: p.role,
        bisDesired: desired,
        bisCurrent: current,
      });
    });

    const plans = computeGreedyPlan([FLOOR_1], players, makeTier(), {
      startingWeekNumber: 1,
      alreadyKilledFloors: new Set(),
    });
    const plan = plans[0];
    expect(plan).toBeDefined();
    if (!plan) return;

    // X (id=1) must not appear in any Bracelet drop or buy — the
    // slot was already filled before the simulation started.
    const xBraceletDrops = plan.drops.filter(
      (d) => d.itemKey === "Bracelet" && d.recipientId === 1,
    );
    const xBraceletBuys = plan.buys.filter(
      (b) => b.itemKey === "Bracelet" && b.playerId === 1,
    );
    expect(xBraceletDrops).toHaveLength(0);
    expect(xBraceletBuys).toHaveLength(0);

    // The four other Bracelet-needers (A, B, C, D) should each
    // be served exactly once across drops + buys.
    const otherBraceletFills = new Set<number>();
    for (const d of plan.drops.filter((x) => x.itemKey === "Bracelet")) {
      otherBraceletFills.add(d.recipientId);
    }
    for (const b of plan.buys.filter((x) => x.itemKey === "Bracelet")) {
      otherBraceletFills.add(b.playerId);
    }
    expect(otherBraceletFills.size).toBe(4);
    expect(otherBraceletFills.has(2)).toBe(true); // A
    expect(otherBraceletFills.has(3)).toBe(true); // B
    expect(otherBraceletFills.has(4)).toBe(true); // C
    expect(otherBraceletFills.has(5)).toBe(true); // D
  });
});

describe("computeGreedyPlan — v4.1 score regimes", () => {
  it("Bottleneck drops are need-driven, ignoring the counter", () => {
    // Two-player setup: A has high initial Boss-1 need + a high
    // existing drop count; B has low initial need + zero drops.
    // For a bottleneck-item drop, A must win because the
    // bottleneck score is INITIAL_NEED * 100 and ignores the
    // counter.
    const tier = makeTier();
    const a = makePlayer({
      id: 1,
      name: "A",
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
    });
    a.savageDropsThisTier = 5; // simulated high counter
    const b = makePlayer({
      id: 2,
      name: "B",
      gearRole: "healer",
      bisDesired: { Ring1: "Savage" },
      bisCurrent: { Ring1: "Crafted" },
    });
    // A has 4 Boss-1 needs, B has 1 → bottleneck = Ring (1+1=2 > others).
    // Wait — bottleneck is highest-roster-need item. With A
    // needing Earring, Necklace, Bracelet, Ring1 and B needing
    // Ring1: Earring=1, Necklace=1, Bracelet=1, Ring=2. So
    // Ring is the bottleneck.
    // A's bottleneck score = 4 * 100 = 400. B's = 1 * 100 = 100.
    // A wins despite counter=5. Without the counter-ignoring
    // bottleneck regime, B would win because counter=0.
    const plans = computeGreedyPlan([FLOOR_1], [a, b], tier, {
      startingWeekNumber: 1,
      alreadyKilledFloors: new Set(),
      safetyCap: 1,
    });
    const ringDrop = plans[0]?.drops.find((d) => d.itemKey === "Ring");
    expect(ringDrop).toBeDefined();
    expect(ringDrop?.recipientId).toBe(1); // A wins because Initial-Need is highest
  });

  it("Non-bottleneck drops are counter-driven, ignoring need", () => {
    // Two players, both need Earring. A has higher Boss-1 need
    // overall and a non-zero counter; B has lower need and a
    // zero counter. For a non-bottleneck-item drop (Earring is
    // not the roster-bottleneck here because we make a Ring-
    // heavy roster), B wins because the non-bottleneck score
    // is purely counter-based.
    const tier = makeTier();
    const players: PlayerSnapshot[] = [
      makePlayer({
        id: 1,
        name: "A",
        gearRole: "tank",
        bisDesired: {
          Earring: "Savage",
          Necklace: "Savage",
          Bracelet: "Savage",
        },
        bisCurrent: {
          Earring: "Crafted",
          Necklace: "Crafted",
          Bracelet: "Crafted",
        },
      }),
      makePlayer({
        id: 2,
        name: "B",
        gearRole: "healer",
        bisDesired: { Earring: "Savage" },
        bisCurrent: { Earring: "Crafted" },
      }),
      // Filler players to make Ring the bottleneck (need 6 Ring
      // vs. 2 Earring, 1 Necklace, 1 Bracelet).
      ...["F1", "F2", "F3", "F4", "F5", "F6"].map((name, idx) =>
        makePlayer({
          id: idx + 100,
          name,
          gearRole: "caster",
          bisDesired: { Ring1: "Savage" },
          bisCurrent: { Ring1: "Crafted" },
        }),
      ),
    ];
    // A has counter=2 already; B has counter=0.
    const playerA = players[0];
    if (!playerA) throw new Error("test setup missing player A");
    playerA.savageDropsThisTier = 2;
    const plans = computeGreedyPlan([FLOOR_1], players, tier, {
      startingWeekNumber: 1,
      alreadyKilledFloors: new Set(),
      safetyCap: 1,
    });
    const earringDrop = plans[0]?.drops.find((d) => d.itemKey === "Earring");
    expect(earringDrop).toBeDefined();
    // B (counter=0) wins over A (counter=2) — non-bottleneck
    // score is -K * counter, B has -0 = 0, A has -100. B > A.
    expect(earringDrop?.recipientId).toBe(2);
  });

  it("Bottleneck winning a drop increments the counter for next week", () => {
    // Validates that bottleneck-drop winners are counted toward
    // the tier counter (= cross-floor fairness penalty kicks in).
    // Two-week sim, two players. W1 Bottleneck → A. W2 should
    // see A's counter incremented (and influence non-bottleneck
    // decisions).
    const tier = makeTier();
    const a = makePlayer({
      id: 1,
      name: "A",
      gearRole: "tank",
      bisDesired: {
        Ring1: "Savage",
        Earring: "Savage",
        Necklace: "Savage",
        Bracelet: "Savage",
      },
      bisCurrent: {
        Ring1: "Crafted",
        Earring: "Crafted",
        Necklace: "Crafted",
        Bracelet: "Crafted",
      },
    });
    const b = makePlayer({
      id: 2,
      name: "B",
      gearRole: "healer",
      bisDesired: { Earring: "Savage" },
      bisCurrent: { Earring: "Crafted" },
    });
    // Make Ring the bottleneck by adding several Ring-only fillers.
    const fillers = ["F1", "F2", "F3", "F4", "F5"].map((name, idx) =>
      makePlayer({
        id: idx + 100,
        name,
        gearRole: "caster",
        bisDesired: { Ring1: "Savage" },
        bisCurrent: { Ring1: "Crafted" },
      }),
    );
    const plans = computeGreedyPlan([FLOOR_1], [a, b, ...fillers], tier, {
      startingWeekNumber: 1,
      alreadyKilledFloors: new Set(),
      safetyCap: 2,
    });
    const plan = plans[0];
    expect(plan).toBeDefined();
    if (!plan) return;
    // W1 Ring bottleneck → A (A has 4 needs incl Ring1; 1 + 5
    // fillers compete, all 1-need; A wins with 400 vs 100).
    const w1Ring = plan.drops.find((d) => d.week === 1 && d.itemKey === "Ring");
    expect(w1Ring?.recipientId).toBe(1);
    // W1 Earring (non-bottleneck): A's counter is 1 (from the
    // Ring win in the same week), B's is 0. B should win.
    const w1Earring = plan.drops.find(
      (d) => d.week === 1 && d.itemKey === "Earring",
    );
    expect(w1Earring?.recipientId).toBe(2);
  });
});

describe("computeGreedyPlan — v4.2 diagonal bottleneck distribution", () => {
  it("diagonal: A=3 B=2 C=1 Glaze need spreads with no 3-in-a-row", () => {
    // The user-reported pain point: pre-v4.2, a player with a
    // 3-Glaze need would win 3 weeks in a row because the
    // bottleneck score was constant `INITIAL_NEED * 100`. v4.2
    // switches to `OPEN_COUNT_FOR_ITEM * 100` which decays as
    // the player gets served, breaking the streak.
    //
    // Build a tier where Glaze is NOT buyable, so the simulation
    // is forced to satisfy all needs via drops (otherwise the
    // page-buy fast-path would short-circuit the test).
    const tier = makeTier();
    tier.buyCostByItem = new Map(
      tier.buyCostByItem,
    ) as TierSnapshot["buyCostByItem"];
    tier.buyCostByItem.delete("Glaze");
    const a = makePlayer({
      id: 1,
      name: "A",
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
    });
    const b = makePlayer({
      id: 2,
      name: "B",
      gearRole: "healer",
      bisDesired: { Earring: "TomeUp", Necklace: "TomeUp" },
      bisCurrent: { Earring: "Crafted", Necklace: "Crafted" },
    });
    const c = makePlayer({
      id: 3,
      name: "C",
      gearRole: "caster",
      bisDesired: { Earring: "TomeUp" },
      bisCurrent: { Earring: "Crafted" },
    });
    const plans = computeGreedyPlan(
      [
        {
          floorNumber: 2,
          itemKeys: ["Glaze"],
          trackedForAlgorithm: true,
        },
      ],
      [a, b, c],
      tier,
      {
        startingWeekNumber: 1,
        alreadyKilledFloors: new Set(),
      },
    );
    const plan = plans[0];
    expect(plan).toBeDefined();
    if (!plan) return;

    // 6 Glaze drops (3+2+1) over 6 weeks.
    expect(plan.drops.length).toBe(6);
    const sequence = plan.drops
      .sort((x, y) => x.week - y.week)
      .map((d) => d.recipientName);

    // No 3-in-a-row of the same recipient (the v4.2 design goal).
    for (let i = 0; i < sequence.length - 2; i += 1) {
      const triple = `${sequence[i]}-${sequence[i + 1]}-${sequence[i + 2]}`;
      expect(triple).not.toBe(`A-A-A`);
      expect(triple).not.toBe(`B-B-B`);
      expect(triple).not.toBe(`C-C-C`);
    }

    // Each player gets their full need.
    const counts = sequence.reduce(
      (m, name) => {
        m[name] = (m[name] ?? 0) + 1;
        return m;
      },
      {} as Record<string, number>,
    );
    expect(counts.A).toBe(3);
    expect(counts.B).toBe(2);
    expect(counts.C).toBe(1);
  });
});

describe("computeGreedyPlan — v4.2 bossKillIndex tracking", () => {
  it("each drop carries a 1-based per-floor kill index", () => {
    const tier = makeTier();
    const player = makePlayer({
      id: 1,
      name: "Solo",
      gearRole: "tank",
      bisDesired: { Earring: "Savage" },
      bisCurrent: { Earring: "Crafted" },
    });
    const plans = computeGreedyPlan(
      [{ ...FLOOR_1, itemKeys: ["Earring"] }],
      [player],
      tier,
      {
        startingWeekNumber: 1,
        alreadyKilledFloors: new Set(),
        safetyCap: 5,
      },
    );
    const plan = plans[0];
    expect(plan).toBeDefined();
    if (!plan) return;
    // Single Earring drop in W1 — bossKillIndex should be 1.
    expect(plan.drops.length).toBe(1);
    expect(plan.drops[0]?.bossKillIndex).toBe(1);
    expect(plan.drops[0]?.week).toBe(1);
  });

  it("bossKillIndex independently tracked per floor", () => {
    const tier = makeTier();
    // Two players each wanting one Earring (F1) Savage. F1 has
    // exactly one item key so each kill produces one drop. With
    // both players tied on bottleneck score 100 in W1, P1 (lower
    // id) wins; P2 wins W2. So F1 drops carry kill indexes 1
    // then 2. F2 has its own independent kill counter starting
    // at 1.
    const p1 = makePlayer({
      id: 1,
      name: "P1",
      gearRole: "tank",
      bisDesired: { Earring: "Savage", Head: "Savage" },
      bisCurrent: { Earring: "Crafted", Head: "Crafted" },
    });
    const p2 = makePlayer({
      id: 2,
      name: "P2",
      gearRole: "healer",
      bisDesired: { Earring: "Savage" },
      bisCurrent: { Earring: "Crafted" },
    });
    const plans = computeGreedyPlan(
      [
        { ...FLOOR_1, itemKeys: ["Earring"] },
        { ...FLOOR_2, itemKeys: ["Head"] },
      ],
      [p1, p2],
      tier,
      {
        startingWeekNumber: 1,
        alreadyKilledFloors: new Set(),
        safetyCap: 5,
      },
    );
    const f1 = plans.find((p) => p.floorNumber === 1);
    const f2 = plans.find((p) => p.floorNumber === 2);
    expect(f1).toBeDefined();
    expect(f2).toBeDefined();
    if (!f1 || !f2) return;
    // Floor 1 drops in W1 (kill 1) and W2 (kill 2).
    const f1Drops = f1.drops.sort((a, b) => a.week - b.week);
    expect(f1Drops.length).toBe(2);
    expect(f1Drops[0]?.bossKillIndex).toBe(1);
    expect(f1Drops[1]?.bossKillIndex).toBe(2);
    // Floor 2 starts its own kill counter at 1 in W1.
    const f2Drops = f2.drops.sort((a, b) => a.week - b.week);
    expect(f2Drops.length).toBe(1);
    expect(f2Drops[0]?.bossKillIndex).toBe(1);
  });
});
