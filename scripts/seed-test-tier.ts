/* eslint-disable no-console */
/**
 * One-shot script that wipes the leftover Cruiserweight stub and
 * provisions a fresh "Test Tier" intended for exercising the
 * loot-distribution algorithm against synthetic BiS plans.
 *
 * Run with:
 *
 *   pnpm tsx scripts/seed-test-tier.ts
 *
 * What it does:
 *
 * 1. Drops every tier whose name matches Cruiserweight or starts
 *    with "Test Tier" so the script is idempotent — re-running it
 *    starts from a clean slate. The cascade deletes everything
 *    that hung off those tiers (players, BiS choices, page
 *    adjustments, raid weeks, boss kills, loot drops).
 * 2. Archives any other currently-active tier — Heavyweight
 *    becomes read-only history while the test tier owns the
 *    "active" slot.
 * 3. Inserts a new "Test Tier" pointing at the canonical
 *    Heavyweight defaults (max iLv 790, the four-floor layout, the
 *    13-row buy-cost table).
 * 4. Copies the previous active tier's roster onto the new tier so
 *    Test Tier launches with the same eight raiders as the
 *    spreadsheet snapshot.
 * 5. Generates a random BiS plan per (player, slot):
 *    - `desiredSource` is `Savage` or `TomeUp` flipped per slot
 *      with a uniform 50/50 split.
 *    - `currentSource` is locked to `Crafted` everywhere so every
 *      slot reads as a meaningful upgrade target — perfect for
 *      eyeballing how the algorithm distributes drops when no one
 *      has any Savage / TomeUp gear yet.
 *
 * The script doesn't seed boss kills or loot drops — Test Tier
 * starts with zero raid history so the page balances begin at zero
 * and grow as the operator adds kills via the UI.
 */

import { resolve } from "node:path";
import { createClient } from "@libsql/client";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env") });

const databaseUrl = process.env.DATABASE_URL ?? "file:data/loot.db";
const client = createClient({ url: databaseUrl });

const SLOTS = [
  "Weapon",
  "Offhand",
  "Head",
  "Chestpiece",
  "Gloves",
  "Pants",
  "Boots",
  "Earring",
  "Necklace",
  "Bracelet",
  "Ring1",
  "Ring2",
] as const;

const TIER_NAME = "Test Tier";
const MAX_ILV = 790;

// Canonical Heavyweight floor + buy-cost defaults — duplicated here
// (rather than imported from the application's ts module) so this
// script stays self-contained and survives schema-side refactors of
// the application code.
const FLOORS = [
  {
    number: 1,
    drops: ["Earring", "Necklace", "Bracelet", "Ring"],
    label: "Edition I",
    tracked: true,
  },
  {
    number: 2,
    drops: ["Head", "Gloves", "Boots", "Glaze"],
    label: "Edition II",
    tracked: true,
  },
  {
    number: 3,
    drops: ["Chestpiece", "Pants", "Twine", "Ester"],
    label: "Edition III",
    tracked: true,
  },
  {
    number: 4,
    drops: ["Weapon"],
    label: "Edition IV",
    tracked: false,
  },
];

const BUY_COSTS: Array<{ itemKey: string; floor: number; cost: number }> = [
  { itemKey: "Earring", floor: 1, cost: 3 },
  { itemKey: "Necklace", floor: 1, cost: 3 },
  { itemKey: "Bracelet", floor: 1, cost: 3 },
  { itemKey: "Ring", floor: 1, cost: 3 },
  { itemKey: "Head", floor: 2, cost: 4 },
  { itemKey: "Gloves", floor: 2, cost: 4 },
  { itemKey: "Boots", floor: 2, cost: 4 },
  { itemKey: "Glaze", floor: 2, cost: 3 },
  { itemKey: "Chestpiece", floor: 3, cost: 6 },
  { itemKey: "Pants", floor: 3, cost: 6 },
  { itemKey: "Twine", floor: 3, cost: 4 },
  { itemKey: "Ester", floor: 3, cost: 4 },
  { itemKey: "Weapon", floor: 4, cost: 8 },
];

// Cascade deltas matching the application's tier defaults
// (Savage 0, TomeUp 0, Catchup -10, Tome -10, Extreme -20, Relic
// -20, Crafted -25, WHYYYY -30, JustNo -40).
function deriveIlv(maxIlv: number, delta: number): number {
  return maxIlv + delta;
}

async function main(): Promise<void> {
  console.log(`[seed-test] using database ${databaseUrl}`);

  // 1. Wipe Cruiserweight + any pre-existing Test Tier.
  const wipeNames = ["Arcadion Cruiserweight"];
  for (const name of wipeNames) {
    const result = await client.execute({
      sql: "DELETE FROM tier WHERE name = ?",
      args: [name],
    });
    console.log(`[seed-test] removed tier "${name}": ${result.rowsAffected}`);
  }
  const wipeTest = await client.execute({
    sql: "DELETE FROM tier WHERE name LIKE ?",
    args: [`${TIER_NAME}%`],
  });
  console.log(
    `[seed-test] removed previous test tier(s): ${wipeTest.rowsAffected}`,
  );

  // 2. Resolve the team + most-recent existing tier so we can copy
  // the roster off it. The team is whichever team owns at least one
  // tier; "most recent" = the tier with the latest createdAt. Since
  // the production DB only has the Heavyweight tier left, this
  // resolves to it deterministically.
  const teamRow = await client.execute("SELECT id FROM team LIMIT 1");
  const teamId = Number(teamRow.rows[0]?.id);
  if (!teamId) throw new Error("[seed-test] no team in DB");

  const sourceRow = await client.execute({
    sql: `SELECT id, name FROM tier
          WHERE team_id = ?
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [teamId],
  });
  const sourceTierId = Number(sourceRow.rows[0]?.id);
  const sourceTierName = String(sourceRow.rows[0]?.name ?? "(none)");
  console.log(
    `[seed-test] copying roster from tier ${sourceTierId} (${sourceTierName})`,
  );

  // 3. Archive every other active tier — only one tier can sit on
  // the "active" slot at a time per the application's invariants.
  await client.execute({
    sql: `UPDATE tier SET archived_at = unixepoch()
          WHERE team_id = ? AND archived_at IS NULL`,
    args: [teamId],
  });

  // 4. Create the Test Tier itself.
  const insertedTier = await client.execute({
    sql: `INSERT INTO tier (
            team_id, name, max_ilv,
            ilv_savage, ilv_tome_up, ilv_catchup, ilv_tome,
            ilv_extreme, ilv_relic, ilv_crafted, ilv_whyyyy, ilv_just_no
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id`,
    args: [
      teamId,
      TIER_NAME,
      MAX_ILV,
      deriveIlv(MAX_ILV, 0), // Savage
      deriveIlv(MAX_ILV, 0), // TomeUp
      deriveIlv(MAX_ILV, -10), // Catchup
      deriveIlv(MAX_ILV, -10), // Tome
      deriveIlv(MAX_ILV, -20), // Extreme
      deriveIlv(MAX_ILV, -20), // Relic
      deriveIlv(MAX_ILV, -25), // Crafted
      deriveIlv(MAX_ILV, -30), // WHYYYY
      deriveIlv(MAX_ILV, -40), // JustNo
    ],
  });
  const testTierId = Number(insertedTier.rows[0]?.id);
  console.log(`[seed-test] inserted Test Tier id=${testTierId}`);

  // 5. Floor layout + buy costs.
  for (const floor of FLOORS) {
    await client.execute({
      sql: `INSERT INTO floor (
              tier_id, number, drops, page_token_label, tracked_for_algorithm
            )
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        testTierId,
        floor.number,
        JSON.stringify(floor.drops),
        `Test ${floor.label}`,
        floor.tracked ? 1 : 0,
      ],
    });
  }
  for (const cost of BUY_COSTS) {
    await client.execute({
      sql: "INSERT INTO tier_buy_cost (tier_id, item_key, floor_number, cost) VALUES (?, ?, ?, ?)",
      args: [testTierId, cost.itemKey, cost.floor, cost.cost],
    });
  }

  // 6. Roster: copy player rows from the source tier with fresh ids
  // attached to the new tier. Ordering preserved via sort_order.
  const sourceRoster = await client.execute({
    sql: `SELECT name, main_job, alt_jobs, gear_link, notes, sort_order
          FROM player
          WHERE tier_id = ?
          ORDER BY sort_order, id`,
    args: [sourceTierId],
  });
  const newPlayerIds: Array<{ id: number; name: string; mainJob: string }> =
    [];
  for (const row of sourceRoster.rows) {
    const inserted = await client.execute({
      sql: `INSERT INTO player (
              tier_id, name, main_job, alt_jobs, gear_link, notes, sort_order
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            RETURNING id, name, main_job AS mainJob`,
      args: [
        testTierId,
        String(row.name),
        String(row.main_job),
        String(row.alt_jobs ?? "[]"),
        row.gear_link ? String(row.gear_link) : null,
        row.notes ? String(row.notes) : null,
        Number(row.sort_order ?? 0),
      ],
    });
    const r = inserted.rows[0];
    if (!r) continue;
    newPlayerIds.push({
      id: Number(r.id),
      name: String(r.name),
      mainJob: String(r.mainJob),
    });
  }
  console.log(`[seed-test] copied ${newPlayerIds.length} players`);

  // 7. Random BiS per (player, slot): desired ∈ {Savage, TomeUp};
  // current = Crafted. The Offhand slot is special-cased to
  // NotPlanned for non-PLD jobs because only paladins actually wear
  // an offhand in modern FF XIV.
  let bisCount = 0;
  for (const player of newPlayerIds) {
    for (const slot of SLOTS) {
      let desired: string;
      let current: string;
      if (slot === "Offhand" && player.mainJob !== "PLD") {
        desired = "NotPlanned";
        current = "NotPlanned";
      } else {
        desired = Math.random() > 0.5 ? "Savage" : "TomeUp";
        current = "Crafted";
      }
      await client.execute({
        sql: `INSERT INTO bis_choice (player_id, slot, desired_source, current_source)
              VALUES (?, ?, ?, ?)`,
        args: [player.id, slot, desired, current],
      });
      bisCount += 1;
    }
  }
  console.log(`[seed-test] inserted ${bisCount} BiS choices`);

  console.log("[seed-test] done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
