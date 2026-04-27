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

  it("removes fully self-served players from gear competition (v2.3)", () => {
    // v2.3 — when ALL of a player's wanted slots on a floor are
    // covered by simulated self-purchase, the algorithm zeroes
    // their score for any drop on that floor. Giving them the
    // drop would just leak it from a teammate who genuinely
    // still needs it. PageRich here has 6 Floor-1 pages = 2
    // buyable accessories, but only 1 needed slot (Earring), so
    // their entire floor wishlist is covered → they drop out of
    // the Earring competition entirely.
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
    expect(ranking[0]?.player.name).toBe("PagePoor");
    expect(ranking[0]?.breakdown.effectiveNeed).toBe(1);
    expect(ranking[0]?.score).toBeGreaterThan(0);
    const rich = ranking.find((s) => s.player.name === "PageRich");
    expect(rich?.breakdown.effectiveNeed).toBe(0);
    expect(rich?.score).toBe(0);
    expect(rich?.breakdown.buyPower).toBe(2);
  });

  it("keeps page-rich players in the competition when other slots remain unmet (v2.3)", () => {
    // The fully-self-served escape hatch only fires when EVERY
    // slot the player wanted on the floor is covered. A player
    // who wanted three accessories but bought only two of them
    // still has 1 unmet slot, so they keep competing for the
    // matching drop at the discounted rate (0.5).
    const players = [
      makePlayer({
        id: 1,
        name: "PartiallySelfServed",
        gearRole: "melee",
        bisDesired: {
          Earring: "Savage",
          Necklace: "Savage",
          Bracelet: "Savage",
        },
        bisCurrent: {
          Earring: "NotPlanned",
          Necklace: "NotPlanned",
          Bracelet: "NotPlanned",
        },
        pages: { 1: 6 }, // 2 buys vs 3 wants — 1 slot still unmet
      }),
    ];
    const earring = scoreDrop(players, context({ itemKey: "Earring" }))[0];
    // 1 of the 3 wants is still uncovered → effectiveNeed > 0.
    expect(earring?.breakdown.effectiveNeed).toBeGreaterThan(0);
    expect(earring?.score).toBeGreaterThan(0);
  });

  it("buys the slot with highest team demand first, leaves rare wants as drops (v2.3)", () => {
    // v2.3 team-demand heuristic: when a player has multiple
    // unmet slots on a floor, simulated self-purchases go to the
    // slot with the highest team-wide demand first. With only one
    // player the team-demand for every wanted slot is 1, so the
    // tiebreaker (canonical SLOTS order) decides — Earring before
    // Necklace before Ring. The bought slot still scores 0.5;
    // the rest score 1.
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

    const earring = scoreDrop([fara], context({ itemKey: "Earring" }))[0];
    expect(earring?.breakdown.effectiveNeed).toBe(0.5);
    expect(earring?.score).toBeGreaterThan(0);

    const necklace = scoreDrop([fara], context({ itemKey: "Necklace" }))[0];
    expect(necklace?.breakdown.effectiveNeed).toBe(1);
    expect(necklace?.score).toBeGreaterThan(earring?.score ?? 0);

    const ring = scoreDrop([fara], context({ itemKey: "Ring" }))[0];
    expect(ring?.breakdown.effectiveNeed).toBe(1);
    expect(ring?.score).toBeGreaterThan(0);
  });

  it("prefers the team's tightest bottleneck for self-purchase (v2.3)", () => {
    // The user's scenario: A wants only Ring, B wants Bracelet
    // + Ring, C wants Earring + Bracelet + Ring. With 1 buy
    // each, every player should buy Ring (team-wide demand for
    // Ring = 3, Bracelet = 2, Earring = 1). After self-purchase:
    //   - A is fully self-served (only wanted Ring) → score 0.
    //   - B has Bracelet still unmet → scores positive on
    //     Bracelet drop and 0.5 on Ring drop.
    //   - C has Earring + Bracelet still unmet → scores positive
    //     on those plus 0.5 on Ring.
    const A = makePlayer({
      id: 1,
      name: "A",
      gearRole: "tank",
      bisDesired: { Ring1: "Savage" },
      bisCurrent: { Ring1: "NotPlanned" },
      pages: { 1: 3 },
    });
    const B = makePlayer({
      id: 2,
      name: "B",
      gearRole: "tank",
      bisDesired: { Bracelet: "Savage", Ring1: "Savage" },
      bisCurrent: { Bracelet: "NotPlanned", Ring1: "NotPlanned" },
      pages: { 1: 3 },
    });
    const C = makePlayer({
      id: 3,
      name: "C",
      gearRole: "tank",
      bisDesired: {
        Earring: "Savage",
        Bracelet: "Savage",
        Ring1: "Savage",
      },
      bisCurrent: {
        Earring: "NotPlanned",
        Bracelet: "NotPlanned",
        Ring1: "NotPlanned",
      },
      pages: { 1: 3 },
    });
    const players = [A, B, C];

    // A is fully self-served → score 0 for any Floor-1 drop.
    for (const itemKey of ["Earring", "Bracelet", "Ring"] as const) {
      const a = scoreDrop(players, context({ itemKey })).find(
        (r) => r.player.name === "A",
      );
      expect(a?.score).toBe(0);
    }

    // C still owns the Earring contest unopposed.
    const earringTop = scoreDrop(players, context({ itemKey: "Earring" }))[0];
    expect(earringTop?.player.name).toBe("C");

    // Bracelet: B and C are tied (both 1.0 effective_need); A is 0.
    const bracelet = scoreDrop(players, context({ itemKey: "Bracelet" }));
    expect(bracelet[0]?.score).toBeGreaterThan(0);
    expect(bracelet.find((r) => r.player.name === "A")?.score).toBe(0);

    // Ring: B and C scored 0.5 (Ring1 in their purchased set);
    // A has the slot purchased AND no other wants → fully
    // self-served → 0.
    const ring = scoreDrop(players, context({ itemKey: "Ring" }));
    expect(ring.find((r) => r.player.name === "A")?.score).toBe(0);
    expect(ring.find((r) => r.player.name === "B")?.score).toBeGreaterThan(0);
    expect(ring.find((r) => r.player.name === "C")?.score).toBeGreaterThan(0);
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
