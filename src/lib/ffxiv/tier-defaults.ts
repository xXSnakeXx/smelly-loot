import type { ItemKey } from "./slots";

/**
 * Defaults the application uses when seeding a brand-new tier.
 *
 * The shape mirrors how the seed file (`src/lib/db/seed.ts`) and the
 * `createTierAction` Server Action both populate the `floor` and
 * `tier_buy_cost` tables for a freshly-created tier. Centralising the
 * data here means the boot-time seed and the in-app "New tier" form
 * stay in lock-step — adding a new floor or adjusting a buy cost is a
 * single-file change.
 *
 * The current set of defaults reflects FF XIV Dawntrail's Heavyweight
 * Savage tier:
 *
 *   - 4 floors total. Floors 1–3 are tracked for the algorithm
 *     (`trackedForAlgorithm = true`); floor 4 is track-only because
 *     weapon distribution is decided outside the page-cost system
 *     (Topic 3 decision in ROADMAP.md).
 *   - 13 buy costs covering every gear slot plus the three upgrade
 *     materials (Glaze / Twine / Ester) and the floor-4 weapon.
 *   - The buy-cost numbers (3 / 4 / 6 / 8 for accessories / small
 *     armor / large armor / weapon, 3 / 4 / 4 for the materials)
 *     match the in-game vendor prices and have stayed consistent
 *     across the last several Savage tiers, so we treat them as the
 *     canonical default.
 */

export interface FloorDefault {
  number: number;
  drops: ItemKey[];
  pageTokenLabel: string;
  trackedForAlgorithm: boolean;
}

export interface BuyCostDefault {
  itemKey: ItemKey;
  floorNumber: number;
  cost: number;
}

export const DEFAULT_FLOORS: ReadonlyArray<FloorDefault> = [
  {
    number: 1,
    drops: ["Earring", "Necklace", "Bracelet", "Ring"],
    pageTokenLabel: "Edition I",
    trackedForAlgorithm: true,
  },
  {
    number: 2,
    drops: ["Head", "Gloves", "Boots", "Glaze"],
    pageTokenLabel: "Edition II",
    trackedForAlgorithm: true,
  },
  {
    number: 3,
    drops: ["Chestpiece", "Pants", "Twine", "Ester"],
    pageTokenLabel: "Edition III",
    trackedForAlgorithm: true,
  },
  {
    number: 4,
    drops: ["Weapon"],
    pageTokenLabel: "Edition IV",
    trackedForAlgorithm: false,
  },
];

export const DEFAULT_BUY_COSTS: ReadonlyArray<BuyCostDefault> = [
  // Floor 1 token — accessories cost 3 each.
  { itemKey: "Earring", floorNumber: 1, cost: 3 },
  { itemKey: "Necklace", floorNumber: 1, cost: 3 },
  { itemKey: "Bracelet", floorNumber: 1, cost: 3 },
  { itemKey: "Ring", floorNumber: 1, cost: 3 },
  // Floor 2 token — small armor + Glaze.
  { itemKey: "Head", floorNumber: 2, cost: 4 },
  { itemKey: "Gloves", floorNumber: 2, cost: 4 },
  { itemKey: "Boots", floorNumber: 2, cost: 4 },
  { itemKey: "Glaze", floorNumber: 2, cost: 3 },
  // Floor 3 token — large armor + Twine + Ester.
  { itemKey: "Chestpiece", floorNumber: 3, cost: 6 },
  { itemKey: "Pants", floorNumber: 3, cost: 6 },
  { itemKey: "Twine", floorNumber: 3, cost: 4 },
  { itemKey: "Ester", floorNumber: 3, cost: 4 },
  // Floor 4 token — main-hand weapon.
  { itemKey: "Weapon", floorNumber: 4, cost: 8 },
];
