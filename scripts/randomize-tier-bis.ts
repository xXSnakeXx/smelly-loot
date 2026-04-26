/* eslint-disable no-console */
/**
 * Randomise a tier's BiS plans for testing the algorithm.
 *
 * Run with:
 *
 *   pnpm tsx scripts/randomize-tier-bis.ts <tier_id>
 *
 * For each player currently in the tier's roster (= every player
 * with at least one `bis_choice` row for the tier), the script
 * UPSERTs a 12-slot BiS plan:
 *
 *   - **Ring1** is locked to `desiredSource = "Savage"`.
 *   - **Ring2** is locked to `desiredSource = "TomeUp"`.
 *   - **Every other slot** picks `desiredSource` uniformly from
 *     {Savage, TomeUp} so the algorithm has a meaningful split.
 *   - **`currentSource`** is `Crafted` everywhere so each slot
 *     reads as a real upgrade target.
 *   - **Offhand** for non-PLD jobs stays `NotPlanned` for both
 *     fields (only paladins ever wear an offhand).
 *
 * The script touches only `bis_choice` rows scoped to the given
 * tier — it leaves loot drops, page adjustments, and the team's
 * other tiers alone. Re-running the script reshuffles the
 * randomised slots; locked Ring1/Ring2/Offhand-non-PLD values
 * stay deterministic.
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

type Slot = (typeof SLOTS)[number];

interface PlayerRow {
  id: number;
  name: string;
  mainJob: string;
}

/**
 * Pick the BiS values for a single (player, slot) pair according
 * to the rules above.
 */
function bisFor(
  slot: Slot,
  mainJob: string,
): { desired: string; current: string } {
  if (slot === "Offhand" && mainJob !== "PLD") {
    return { desired: "NotPlanned", current: "NotPlanned" };
  }
  if (slot === "Ring1") {
    return { desired: "Savage", current: "Crafted" };
  }
  if (slot === "Ring2") {
    return { desired: "TomeUp", current: "Crafted" };
  }
  return {
    desired: Math.random() > 0.5 ? "Savage" : "TomeUp",
    current: "Crafted",
  };
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const tierId = arg ? Number.parseInt(arg, 10) : Number.NaN;
  if (!Number.isInteger(tierId) || tierId <= 0) {
    console.error(
      "Usage: pnpm tsx scripts/randomize-tier-bis.ts <tier_id>",
    );
    process.exit(1);
  }

  console.log(`[randomize-bis] using database ${databaseUrl}`);

  // 1. Resolve the tier (also doubles as a guard against a typo'd id).
  const tierRow = (
    await client.execute({
      sql: "SELECT id, name, max_ilv FROM tier WHERE id = ?",
      args: [tierId],
    })
  ).rows[0];
  if (!tierRow) {
    console.error(`[randomize-bis] no tier with id=${tierId}`);
    process.exit(1);
  }
  console.log(
    `[randomize-bis] target tier: id=${tierRow.id} "${tierRow.name}" (max_ilv=${tierRow.max_ilv})`,
  );

  // 2. Load the tier's roster (= every player with at least one
  //    bis_choice row for the tier; v2.0 implicit-membership rule).
  const rosterRows = (
    await client.execute({
      sql: `SELECT p.id, p.name, p.main_job AS mainJob
            FROM player p
            WHERE p.id IN (
              SELECT DISTINCT player_id FROM bis_choice WHERE tier_id = ?
            )
            ORDER BY p.sort_order, p.id`,
      args: [tierId],
    })
  ).rows;
  const roster: PlayerRow[] = rosterRows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    mainJob: String(r.mainJob),
  }));
  if (roster.length === 0) {
    console.error(
      "[randomize-bis] tier has no roster — add players via the tier's Roster tab first.",
    );
    process.exit(1);
  }
  console.log(`[randomize-bis] roster (${roster.length}):`);
  for (const p of roster) {
    console.log(`  id=${p.id} ${p.name}/${p.mainJob}`);
  }

  // 3. UPSERT one row per (player, tier, slot). The composite PK
  //    on the table is (player_id, tier_id, slot), so the
  //    `ON CONFLICT` clause lets us reshuffle on re-runs without
  //    deleting first. `received_at` and `marker` are deliberately
  //    cleared so the randomiser gives a clean slate every time.
  let count = 0;
  for (const player of roster) {
    for (const slot of SLOTS) {
      const { desired, current } = bisFor(slot, player.mainJob);
      await client.execute({
        sql: `INSERT INTO bis_choice (
                player_id, tier_id, slot, desired_source, current_source,
                received_at, marker
              )
              VALUES (?, ?, ?, ?, ?, NULL, NULL)
              ON CONFLICT(player_id, tier_id, slot) DO UPDATE SET
                desired_source = excluded.desired_source,
                current_source = excluded.current_source,
                received_at = NULL,
                marker = NULL`,
        args: [player.id, tierId, slot, desired, current],
      });
      count += 1;
    }
  }
  console.log(`[randomize-bis] upserted ${count} bis_choice rows`);

  // 4. Quick verification — print Ring1 + Ring2 for each player so
  //    the reader can confirm the locked values landed.
  const verify = (
    await client.execute({
      sql: `SELECT bc.player_id AS playerId, p.name AS name,
                   bc.slot AS slot, bc.desired_source AS desired
            FROM bis_choice bc
            JOIN player p ON p.id = bc.player_id
            WHERE bc.tier_id = ? AND bc.slot IN ('Ring1', 'Ring2')
            ORDER BY p.sort_order, p.id, bc.slot`,
      args: [tierId],
    })
  ).rows;
  console.log("[randomize-bis] Ring1/Ring2 verification:");
  for (const r of verify) {
    console.log(`  ${r.name} ${r.slot} desired=${r.desired}`);
  }
  console.log("[randomize-bis] done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
