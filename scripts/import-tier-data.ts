/* eslint-disable no-console */
/**
 * One-shot import of Mannschaft Smelly's "Arcadion Heavyweight Savage"
 * tier data from the original Google-Sheets tracker.
 *
 * Run with:
 *
 *   pnpm tsx scripts/import-tier-data.ts
 *
 * The script is idempotent: it upserts BiS choices, page adjustments,
 * raid weeks, and boss kills, so re-running it after the team has
 * already touched the UI overwrites the imported snapshot but leaves
 * any *new* data the team has added in place. It does NOT insert
 * synthetic loot drops — page balances are reproduced via
 * `page_adjust` rows so the Track tab can still record real future
 * drops without double-counting historical purchases.
 *
 * The data was transcribed from the spreadsheet snapshot the user
 * provided when smelly-loot was first scaffolded.
 *
 * To reset and re-import from scratch:
 *
 *   sqlite3 data/loot.db "DELETE FROM bis_choice; DELETE FROM page_adjust;
 *                         DELETE FROM boss_kill;  DELETE FROM raid_week;"
 *   pnpm tsx scripts/import-tier-data.ts
 */

import { resolve } from "node:path";
import { createClient } from "@libsql/client";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env") });

const databaseUrl = process.env.DATABASE_URL ?? "file:data/loot.db";
const client = createClient({ url: databaseUrl });

interface PlayerImport {
  /** Spreadsheet name — must match `player.name`. */
  name: string;
  altJobs: string[];
  gearLink?: string;
  notes?: string;
  /**
   * 12 BiS rows, in slot order. `marker` matches the
   * `bis_choice.marker` column (📃, 🔨, ◀️, 💾, 💰, or empty).
   */
  bis: Array<{
    slot: string;
    desired: string;
    current: string;
    marker?: string;
  }>;
  /**
   * "Spent Pages" per floor (1..4). Each value represents how many
   * pages the player has historically spent buying items off that
   * floor's vendor. We translate it into a negative `page_adjust` so
   * the displayed balance matches the spreadsheet without us having
   * to back-fill synthetic loot-drop rows.
   */
  spentPages: [number, number, number, number];
  /**
   * Optional spreadsheet "Pages Adjust" override (per floor). Added
   * on top of `-spentPages`. Only used by The Black Mage in the
   * snapshot we have.
   */
  pagesAdjust?: [number, number, number, number];
}

/**
 * Team kill counts per floor as of the spreadsheet snapshot.
 *
 * Floor 4 stays at 0 — the team's policy is to track but not score
 * weapon distribution (Topic 3 in the roadmap), and no Floor 4 kill
 * had been logged at the time of import.
 */
const TEAM_KILLS_PER_FLOOR: Record<1 | 2 | 3 | 4, number> = {
  1: 9,
  2: 8,
  3: 6,
  4: 0,
};

/**
 * BiS + page snapshot per player. Order mirrors the spreadsheet
 * column layout (Fara, Kuda, Kaz, S'ndae, Quah, Rei, Peter, BLM).
 *
 * `marker` codes follow the spreadsheet legend:
 *   📃 = bought via pages
 *   🔨 = will craft
 *   ◀️ = upgrade next
 *   💾 = save token
 *   💰 = bought via tomes / alt source
 */
const PLAYERS: PlayerImport[] = [
  {
    name: "Fara",
    altJobs: [],
    gearLink: "https://xivgear.app/?page=bis|pld|current",
    bis: [
      { slot: "Weapon", desired: "Savage", current: "TomeUp" },
      { slot: "Offhand", desired: "Savage", current: "TomeUp" },
      { slot: "Head", desired: "Savage", current: "Savage" },
      {
        slot: "Chestpiece",
        desired: "TomeUp",
        current: "TomeUp",
        marker: "📃",
      },
      { slot: "Gloves", desired: "Savage", current: "Savage" },
      { slot: "Pants", desired: "Savage", current: "Savage" },
      { slot: "Boots", desired: "TomeUp", current: "TomeUp", marker: "📃" },
      {
        slot: "Earring",
        desired: "Savage",
        current: "Savage",
        marker: "📃",
      },
      { slot: "Necklace", desired: "TomeUp", current: "TomeUp" },
      {
        slot: "Bracelet",
        desired: "TomeUp",
        current: "TomeUp",
        marker: "📃",
      },
      { slot: "Ring1", desired: "TomeUp", current: "TomeUp", marker: "📃" },
      { slot: "Ring2", desired: "Savage", current: "Savage" },
    ],
    spentPages: [3, 6, 8, 0],
  },
  {
    name: "Kuda",
    altJobs: [],
    gearLink:
      "https://xivgear.app/?page=sl|37cc737e-fc53-40be-b0e4-4a4f695b3ce8",
    bis: [
      { slot: "Weapon", desired: "Savage", current: "Savage" },
      { slot: "Offhand", desired: "NotPlanned", current: "NotPlanned" },
      { slot: "Head", desired: "Savage", current: "Savage" },
      {
        slot: "Chestpiece",
        desired: "TomeUp",
        current: "TomeUp",
        marker: "📃",
      },
      { slot: "Gloves", desired: "Savage", current: "Savage" },
      { slot: "Pants", desired: "Savage", current: "Savage" },
      { slot: "Boots", desired: "TomeUp", current: "TomeUp" },
      { slot: "Earring", desired: "Savage", current: "Savage" },
      { slot: "Necklace", desired: "TomeUp", current: "TomeUp" },
      { slot: "Bracelet", desired: "TomeUp", current: "TomeUp" },
      { slot: "Ring1", desired: "TomeUp", current: "TomeUp" },
      { slot: "Ring2", desired: "Savage", current: "Savage", marker: "📃" },
    ],
    spentPages: [3, 3, 4, 0],
  },
  {
    name: "Kaz",
    altJobs: ["AST"],
    notes: "2.39 max ilvl · double tome ring is cursed af",
    bis: [
      { slot: "Weapon", desired: "Savage", current: "TomeUp" },
      { slot: "Offhand", desired: "NotPlanned", current: "NotPlanned" },
      { slot: "Head", desired: "Savage", current: "Savage" },
      {
        slot: "Chestpiece",
        desired: "TomeUp",
        current: "TomeUp",
        marker: "📃",
      },
      { slot: "Gloves", desired: "Savage", current: "Savage" },
      { slot: "Pants", desired: "Savage", current: "Savage" },
      { slot: "Boots", desired: "Savage", current: "Savage" },
      { slot: "Earring", desired: "TomeUp", current: "TomeUp" },
      { slot: "Necklace", desired: "Savage", current: "Savage" },
      {
        slot: "Bracelet",
        desired: "TomeUp",
        current: "TomeUp",
        marker: "📃",
      },
      { slot: "Ring1", desired: "TomeUp", current: "TomeUp", marker: "📃" },
      { slot: "Ring2", desired: "Savage", current: "Savage", marker: "📃" },
    ],
    spentPages: [3, 6, 4, 0],
  },
  {
    name: "S'ndae",
    altJobs: [],
    gearLink:
      "https://xivgear.app/?page=sl|73551d94-354a-4e30-9205-5d52d2efaf3f",
    bis: [
      { slot: "Weapon", desired: "Savage", current: "Savage" },
      { slot: "Offhand", desired: "NotPlanned", current: "NotPlanned" },
      { slot: "Head", desired: "Savage", current: "Savage" },
      {
        slot: "Chestpiece",
        desired: "TomeUp",
        current: "TomeUp",
        marker: "📃",
      },
      { slot: "Gloves", desired: "Savage", current: "Savage" },
      { slot: "Pants", desired: "Savage", current: "Savage" },
      { slot: "Boots", desired: "Savage", current: "Savage" },
      {
        slot: "Earring",
        desired: "TomeUp",
        current: "TomeUp",
        marker: "📃",
      },
      {
        slot: "Necklace",
        desired: "Savage",
        current: "Savage",
        marker: "📃",
      },
      { slot: "Bracelet", desired: "TomeUp", current: "TomeUp" },
      { slot: "Ring1", desired: "TomeUp", current: "TomeUp", marker: "📃" },
      { slot: "Ring2", desired: "Savage", current: "Savage" },
    ],
    spentPages: [3, 6, 4, 0],
  },
  {
    name: "Quah",
    altJobs: ["RDM"],
    gearLink: "https://xivgear.app/?page=bis|vpr|current",
    bis: [
      { slot: "Weapon", desired: "Savage", current: "TomeUp" },
      { slot: "Offhand", desired: "NotPlanned", current: "NotPlanned" },
      { slot: "Head", desired: "Savage", current: "Savage" },
      { slot: "Chestpiece", desired: "TomeUp", current: "TomeUp" },
      { slot: "Gloves", desired: "TomeUp", current: "TomeUp" },
      { slot: "Pants", desired: "Savage", current: "Savage" },
      { slot: "Boots", desired: "TomeUp", current: "TomeUp", marker: "📃" },
      { slot: "Earring", desired: "Savage", current: "Savage" },
      {
        slot: "Necklace",
        desired: "Savage",
        current: "Savage",
        marker: "📃",
      },
      {
        slot: "Bracelet",
        desired: "TomeUp",
        current: "TomeUp",
        marker: "📃",
      },
      { slot: "Ring1", desired: "TomeUp", current: "TomeUp" },
      { slot: "Ring2", desired: "Savage", current: "Savage" },
    ],
    spentPages: [3, 3, 4, 0],
  },
  {
    name: "Rei",
    altJobs: [],
    gearLink:
      "https://xivgear.app/?page=embed|sl|5dea6a89-2d1d-483c-9b36-f2610ade678e&onlySetIndex=0",
    bis: [
      { slot: "Weapon", desired: "Savage", current: "TomeUp" },
      { slot: "Offhand", desired: "NotPlanned", current: "NotPlanned" },
      { slot: "Head", desired: "TomeUp", current: "TomeUp" },
      { slot: "Chestpiece", desired: "Savage", current: "Savage" },
      { slot: "Gloves", desired: "Savage", current: "Savage" },
      { slot: "Pants", desired: "TomeUp", current: "TomeUp" },
      { slot: "Boots", desired: "TomeUp", current: "TomeUp" },
      { slot: "Earring", desired: "TomeUp", current: "TomeUp" },
      { slot: "Necklace", desired: "Savage", current: "Savage" },
      { slot: "Bracelet", desired: "TomeUp", current: "TomeUp" },
      { slot: "Ring1", desired: "TomeUp", current: "TomeUp", marker: "📃" },
      { slot: "Ring2", desired: "Savage", current: "Savage", marker: "📃" },
    ],
    spentPages: [3, 3, 0, 0],
  },
  {
    name: "Peter",
    altJobs: [],
    notes: "2.15 GCD",
    gearLink:
      "https://xivgear.app/?page=sl|4bd90c49-7a54-483f-9107-042c89c8c68f",
    bis: [
      { slot: "Weapon", desired: "Savage", current: "TomeUp" },
      { slot: "Offhand", desired: "NotPlanned", current: "NotPlanned" },
      { slot: "Head", desired: "Savage", current: "Savage" },
      { slot: "Chestpiece", desired: "Savage", current: "Savage" },
      { slot: "Gloves", desired: "Savage", current: "Savage" },
      { slot: "Pants", desired: "TomeUp", current: "TomeUp", marker: "📃" },
      { slot: "Boots", desired: "TomeUp", current: "TomeUp" },
      { slot: "Earring", desired: "Savage", current: "Savage" },
      {
        slot: "Necklace",
        desired: "TomeUp",
        current: "TomeUp",
        marker: "📃",
      },
      {
        slot: "Bracelet",
        desired: "TomeUp",
        current: "TomeUp",
        marker: "📃",
      },
      { slot: "Ring1", desired: "TomeUp", current: "TomeUp" },
      { slot: "Ring2", desired: "Savage", current: "Savage", marker: "📃" },
    ],
    spentPages: [3, 6, 4, 0],
  },
  {
    name: "The Black Mage",
    altJobs: [],
    gearLink:
      "https://xivgear.app/?page=sl|08698620-8f30-42df-b4c8-df525fe78a95&onlySetIndex=0",
    bis: [
      { slot: "Weapon", desired: "Savage", current: "Savage" },
      { slot: "Offhand", desired: "NotPlanned", current: "NotPlanned" },
      { slot: "Head", desired: "TomeUp", current: "TomeUp" },
      { slot: "Chestpiece", desired: "TomeUp", current: "TomeUp" },
      { slot: "Gloves", desired: "TomeUp", current: "TomeUp" },
      { slot: "Pants", desired: "Savage", current: "Savage" },
      { slot: "Boots", desired: "Savage", current: "Savage" },
      {
        slot: "Earring",
        desired: "TomeUp",
        current: "TomeUp",
        marker: "📃",
      },
      { slot: "Necklace", desired: "Savage", current: "Savage" },
      { slot: "Bracelet", desired: "Savage", current: "Savage" },
      { slot: "Ring1", desired: "TomeUp", current: "TomeUp" },
      { slot: "Ring2", desired: "Savage", current: "Savage", marker: "📃" },
    ],
    spentPages: [3, 3, 0, 0],
    pagesAdjust: [-2, -2, -2, 0],
  },
];

async function main(): Promise<void> {
  console.log(`[import] using database ${databaseUrl}`);

  // 1. Look up the active tier and its floors / players. Everything
  // we insert below is keyed off this tier id, so we fail loudly if
  // the seed didn't run.
  const tierRow = await client.execute(
    "SELECT id, team_id FROM tier WHERE archived_at IS NULL LIMIT 1",
  );
  const tierId = Number(tierRow.rows[0]?.id);
  const teamId = Number(tierRow.rows[0]?.team_id);
  if (!tierId || !teamId) {
    throw new Error(
      "[import] no active tier found; run the dev server once so the seed creates one",
    );
  }
  console.log(`[import] active tier id=${tierId}, team id=${teamId}`);

  const floorRows = await client.execute({
    sql: "SELECT id, number FROM floor WHERE tier_id = ? ORDER BY number",
    args: [tierId],
  });
  const floorIdByNumber = new Map<number, number>(
    floorRows.rows.map((r) => [Number(r.number), Number(r.id)]),
  );
  console.log(
    `[import] floors: ${[...floorIdByNumber.entries()]
      .map(([n, id]) => `${n}→#${id}`)
      .join(", ")}`,
  );

  const playerRows = await client.execute({
    sql: "SELECT id, name FROM player WHERE team_id = ?",
    args: [teamId],
  });
  const playerIdByName = new Map<string, number>(
    playerRows.rows.map((r) => [String(r.name), Number(r.id)]),
  );
  console.log(
    `[import] players in DB: ${[...playerIdByName.keys()].join(", ")}`,
  );

  // 2. Update player metadata (alt jobs, gear link, notes).
  for (const player of PLAYERS) {
    const id = playerIdByName.get(player.name);
    if (!id) {
      console.warn(`[import] skipping ${player.name} — not in DB`);
      continue;
    }
    await client.execute({
      sql: `UPDATE player
            SET alt_jobs = ?, gear_link = ?, notes = ?
            WHERE id = ?`,
      args: [
        JSON.stringify(player.altJobs),
        player.gearLink ?? null,
        player.notes ?? null,
        id,
      ],
    });
  }
  console.log(`[import] player metadata updated`);

  // 3. Upsert BiS choices.
  for (const player of PLAYERS) {
    const id = playerIdByName.get(player.name);
    if (!id) continue;
    for (const row of player.bis) {
      await client.execute({
        sql: `INSERT INTO bis_choice
                (player_id, slot, desired_source, current_source, marker, received_at)
              VALUES (?, ?, ?, ?, ?, NULL)
              ON CONFLICT(player_id, slot) DO UPDATE SET
                desired_source = excluded.desired_source,
                current_source = excluded.current_source,
                marker         = excluded.marker`,
        args: [id, row.slot, row.desired, row.current, row.marker ?? null],
      });
    }
  }
  console.log(
    `[import] BiS choices upserted (${PLAYERS.reduce((s, p) => s + p.bis.length, 0)} rows)`,
  );

  // 4. Upsert page adjustments per (player, tier, floor). The
  // formula is `adjust = -spent + spreadsheet_adjust`, which keeps
  // the displayed balance identical to the spreadsheet's
  // `Current Pages` row.
  for (const player of PLAYERS) {
    const id = playerIdByName.get(player.name);
    if (!id) continue;
    for (let f = 1; f <= 4; f += 1) {
      const spent = player.spentPages[(f - 1) as 0 | 1 | 2 | 3];
      const adjustOverride =
        player.pagesAdjust?.[(f - 1) as 0 | 1 | 2 | 3] ?? 0;
      const adjust = -spent + adjustOverride;
      if (adjust === 0) continue;
      await client.execute({
        sql: `INSERT INTO page_adjust
                (player_id, tier_id, floor_number, delta)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(player_id, tier_id, floor_number) DO UPDATE SET
                delta = excluded.delta`,
        args: [id, tierId, f, adjust],
      });
    }
  }
  console.log(`[import] page adjustments upserted`);

  // 5. Raid weeks + boss kills.
  // We model the team-clears row (F1=9, F2=8, F3=6, F4=0) as nine
  // weeks with the kill schedule below. The exact week numbering
  // doesn't matter for the algorithm (which only counts kills per
  // floor), but a monotonic 1..9 sequence makes the History tab
  // read sensibly.
  const totalWeeks = TEAM_KILLS_PER_FLOOR[1];
  for (let w = 1; w <= totalWeeks; w += 1) {
    await client.execute({
      sql: `INSERT INTO raid_week (tier_id, week_number, started_at)
            VALUES (?, ?, unixepoch())
            ON CONFLICT(tier_id, week_number) DO NOTHING`,
      args: [tierId, w],
    });
  }
  const weekRows = await client.execute({
    sql: "SELECT id, week_number FROM raid_week WHERE tier_id = ? ORDER BY week_number",
    args: [tierId],
  });
  const weekIdByNumber = new Map<number, number>(
    weekRows.rows.map((r) => [Number(r.week_number), Number(r.id)]),
  );

  // Schedule: oldest weeks are F1-only progression weeks, then F1+F2,
  // then full F1+F2+F3 clears. Pick the schedule so the totals match
  // (F1=9, F2=8, F3=6).
  const f1Weeks = totalWeeks; // 9
  const f2Weeks = TEAM_KILLS_PER_FLOOR[2]; // 8 — skip the earliest week
  const f3Weeks = TEAM_KILLS_PER_FLOOR[3]; // 6 — skip the three earliest

  for (let w = 1; w <= totalWeeks; w += 1) {
    const weekId = weekIdByNumber.get(w);
    if (!weekId) continue;
    if (w >= totalWeeks - f1Weeks + 1) {
      await insertKill(weekId, floorIdByNumber.get(1));
    }
    if (w >= totalWeeks - f2Weeks + 1) {
      await insertKill(weekId, floorIdByNumber.get(2));
    }
    if (w >= totalWeeks - f3Weeks + 1) {
      await insertKill(weekId, floorIdByNumber.get(3));
    }
  }
  console.log(`[import] ${totalWeeks} raid weeks + boss kills upserted`);

  console.log("[import] done.");
}

async function insertKill(
  raidWeekId: number,
  floorId: number | undefined,
): Promise<void> {
  if (floorId === undefined) return;
  await client.execute({
    sql: `INSERT INTO boss_kill (raid_week_id, floor_id, cleared_at)
          VALUES (?, ?, unixepoch())
          ON CONFLICT(raid_week_id, floor_id) DO NOTHING`,
    args: [raidWeekId, floorId],
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
