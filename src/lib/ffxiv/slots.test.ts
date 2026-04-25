import { describe, expect, it } from "vitest";

import {
  BIS_SOURCES,
  DEFAULT_ILV_DELTAS,
  deriveSourceIlvs,
  ITEM_KEYS,
  SLOTS,
} from "./slots";

describe("SLOTS", () => {
  it("lists exactly the 12 slot positions a player wears", () => {
    expect(SLOTS).toHaveLength(12);
  });

  it("contains both ring slots so each can have its own desired source", () => {
    expect(SLOTS).toContain("Ring1");
    expect(SLOTS).toContain("Ring2");
  });
});

describe("BIS_SOURCES", () => {
  it("covers all eight spreadsheet sources plus NotPlanned (Topic 5 decision)", () => {
    expect(BIS_SOURCES).toEqual([
      "Savage",
      "TomeUp",
      "Catchup",
      "Tome",
      "Extreme",
      "Relic",
      "Crafted",
      "WHYYYY",
      "JustNo",
      "NotPlanned",
    ]);
  });
});

describe("ITEM_KEYS", () => {
  it("collapses Ring1/Ring2 into a single Ring drop", () => {
    expect(ITEM_KEYS).toContain("Ring");
    expect(ITEM_KEYS).not.toContain("Ring1");
    expect(ITEM_KEYS).not.toContain("Ring2");
  });

  it("includes the three upgrade materials", () => {
    expect(ITEM_KEYS).toContain("Glaze");
    expect(ITEM_KEYS).toContain("Twine");
    expect(ITEM_KEYS).toContain("Ester");
  });
});

describe("deriveSourceIlvs", () => {
  it("derives the Heavyweight tier numbers from max_ilv = 790", () => {
    // The Heavyweight Savage tier caps at 790 for everything except
    // the floor-4 weapon (795) — which the algorithm doesn't compete
    // on. TomeUp lands on the same 790 cap (an upgraded tome piece
    // reaches the Savage iLv exactly); Catchup and Tome both sit at
    // 780.
    const ilvs = deriveSourceIlvs(790);
    expect(ilvs.Savage).toBe(790);
    expect(ilvs.TomeUp).toBe(790);
    expect(ilvs.Catchup).toBe(780);
    expect(ilvs.Tome).toBe(780);
    expect(ilvs.Extreme).toBe(770);
    expect(ilvs.Relic).toBe(770);
    expect(ilvs.Crafted).toBe(765);
    expect(ilvs.WHYYYY).toBe(760);
    expect(ilvs.JustNo).toBe(750);
  });

  it("scales linearly to a future tier with max_ilv = 840", () => {
    const ilvs = deriveSourceIlvs(840);
    expect(ilvs.Savage).toBe(840);
    expect(ilvs.TomeUp).toBe(840);
    expect(ilvs.JustNo).toBe(800);
  });

  it("returns an entry for every BiS source", () => {
    const ilvs = deriveSourceIlvs(790);
    for (const source of BIS_SOURCES) {
      expect(ilvs[source]).toBeDefined();
    }
  });
});

describe("DEFAULT_ILV_DELTAS", () => {
  it("has Savage at the apex (delta 0)", () => {
    expect(DEFAULT_ILV_DELTAS.Savage).toBe(0);
  });

  it("non-strictly decreases through the spreadsheet's legend order", () => {
    // Pairs are allowed to share an iLv (Savage = TomeUp at cap,
    // Catchup = Tome at cap − 10) since the upgraded tome piece
    // reaches the Savage iLv exactly.
    expect(DEFAULT_ILV_DELTAS.Savage).toBeGreaterThanOrEqual(
      DEFAULT_ILV_DELTAS.TomeUp,
    );
    expect(DEFAULT_ILV_DELTAS.TomeUp).toBeGreaterThan(
      DEFAULT_ILV_DELTAS.Catchup,
    );
    expect(DEFAULT_ILV_DELTAS.Catchup).toBeGreaterThanOrEqual(
      DEFAULT_ILV_DELTAS.Tome,
    );
    expect(DEFAULT_ILV_DELTAS.Tome).toBeGreaterThan(DEFAULT_ILV_DELTAS.Crafted);
    expect(DEFAULT_ILV_DELTAS.Crafted).toBeGreaterThan(
      DEFAULT_ILV_DELTAS.WHYYYY,
    );
    expect(DEFAULT_ILV_DELTAS.WHYYYY).toBeGreaterThan(
      DEFAULT_ILV_DELTAS.JustNo,
    );
  });
});
