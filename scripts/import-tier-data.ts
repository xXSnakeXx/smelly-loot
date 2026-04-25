/* eslint-disable no-console */
/**
 * One-shot import of Mannschaft Smelly's "Arcadion Heavyweight Savage"
 * tier snapshot from the original Google-Sheets tracker.
 *
 * Run with:
 *
 *   pnpm import:tier
 *
 * The script reproduces three tabs from the spreadsheet:
 *
 *   - **Mannschaft Smelly Gear Tracker** — player metadata (alt
 *     jobs, gear-set links, notes), the 12-slot BiS plan per
 *     player, plus the "Pages Adjust" overrides surfaced for the
 *     player who joined mid-tier.
 *   - **Heavyweight Loot** — the per-week distribution table.
 *     Every Recipient cell becomes a `loot_drop` row, and the
 *     presence of a recipient on a given floor in a given week
 *     marks that floor as cleared (`boss_kill`).
 *   - The team-clears row (which in the gear tracker showed
 *     F1=9 / F2=8 / F3=6 / F4=0 as of week 9) is *not* used as a
 *     source of truth — the loot tab is more recent and is
 *     authoritative. Page balances are derived as
 *     `kills + page_adjust − tokens_spent`, where `tokens_spent`
 *     counts `loot_drop` rows with `paid_with_pages = true`. The
 *     spreadsheet doesn't distinguish between natural drops and
 *     token purchases, so every imported drop lands as
 *     `paid_with_pages = false`; if a downstream user wants the
 *     "Spent" column to reflect actual page-buys, they can flip
 *     individual drops in the UI.
 *
 * The script is **destructive for raid_week / boss_kill / loot_drop**
 * (every row scoped to the active tier is deleted before re-import)
 * but **non-destructive for bis_choice / page_adjust / player**
 * (those are upserted, so manual UI edits the team has made between
 * runs survive).
 */

import { resolve } from "node:path";
import { createClient } from "@libsql/client";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env") });

const databaseUrl = process.env.DATABASE_URL ?? "file:data/loot.db";
const client = createClient({ url: databaseUrl });

// ─── Player snapshot ───────────────────────────────────────────────

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
   * "Spent Pages" per floor (1..4) from the gear tracker's W9 snapshot.
   * Translated into a negative `page_adjust` so the W9 balance reads
   * as the spreadsheet did. New kills logged after W9 push the
   * balance up by one per kill, which is the correct behaviour as
   * long as no further token purchases happen.
   */
  spentPages: [number, number, number, number];
  /**
   * Optional spreadsheet "Pages Adjust" override (per floor). Added
   * on top of `-spentPages`. The Black Mage / Brad has -2 across
   * the first three floors in the gear tracker.
   */
  pagesAdjust?: [number, number, number, number];
}

/**
 * BiS + page snapshot per player. Order mirrors the gear-tracker
 * column layout. The gear tracker uses "The Black Mage" as a
 * placeholder name for Brad; the loot tab uses "Brad" directly.
 * The script renames `player.name` from "The Black Mage" → "Brad"
 * before doing anything else, so the BiS plan transcribed below
 * lands on the correctly-named row.
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
    name: "Brad",
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

// ─── Loot history ──────────────────────────────────────────────────

/**
 * Maps a column position in the spreadsheet's loot tab to an item /
 * floor pair. Positions that we deliberately don't import (page
 * tokens, F4 coffer / chestpiece-from-coffer, the Mount cosmetic)
 * are `null`.
 *
 * The columns mirror the loot tab's header row exactly:
 *
 *   0  Earring        F1
 *   1  Necklace       F1
 *   2  Bracelet       F1
 *   3  Ring           F1
 *   4  Head           F2
 *   5  Gloves         F2
 *   6  Boots          F2
 *   7  Token          F2  (skip — page-token cosmetic counter)
 *   8  Glaze          F2
 *   9  Chestpiece     F3
 *   10 Pants          F3
 *   11 Twine          F3
 *   12 Ester          F3
 *   13 Weapon         F4
 *   14 Coffer         F4  (skip — page-token-token cosmetic)
 *   15 Chestpiece F4  F4  (skip — duplicate slot)
 *   16 Mount          F4  (skip — cosmetic)
 */
const POSITION_TO_ITEM: Array<{
  itemKey: string;
  floor: 1 | 2 | 3 | 4;
} | null> = [
  { itemKey: "Earring", floor: 1 },
  { itemKey: "Necklace", floor: 1 },
  { itemKey: "Bracelet", floor: 1 },
  { itemKey: "Ring", floor: 1 },
  { itemKey: "Head", floor: 2 },
  { itemKey: "Gloves", floor: 2 },
  { itemKey: "Boots", floor: 2 },
  null,
  { itemKey: "Glaze", floor: 2 },
  { itemKey: "Chestpiece", floor: 3 },
  { itemKey: "Pants", floor: 3 },
  { itemKey: "Twine", floor: 3 },
  { itemKey: "Ester", floor: 3 },
  { itemKey: "Weapon", floor: 4 },
  null,
  null,
  null,
];

/**
 * Per-week recipient grid. Each entry has 17 cells matching
 * `POSITION_TO_ITEM`. `null` means no recipient for that slot in
 * that week (item didn't drop / wasn't distributed). The literal
 * string `"(Other)"` means the recipient was outside the static
 * (PUG, dropped to floor, etc.) — those rows land as
 * `loot_drop.recipient_id = NULL` to preserve the entry without
 * crediting it to anyone in the team.
 *
 * Transcribed from the Heavyweight Loot tab (weeks 1..13).
 */
const LOOT_HISTORY: ReadonlyArray<ReadonlyArray<string | null>> = [
  // Week 1 — F1 only
  [
    "Peter",
    "Rei",
    "Brad",
    "Quah",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ],
  // Week 2 — F1 + F2
  [
    "Quah",
    "Brad",
    "Rei",
    "S'ndae",
    "Fara",
    "Peter",
    "Kaz",
    "Rei",
    "Quah",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ],
  // Week 3 — F1 + F2
  [
    "Fara",
    "Kaz",
    "Peter",
    "Kuda",
    "Kuda",
    "Rei",
    "S'ndae",
    "Peter",
    "Brad",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ],
  // Week 4 — F1 + F2 + F3 (Fara cleaned up F1 via tokens)
  [
    "Fara",
    "Fara",
    "Fara",
    "Fara",
    "Quah",
    "S'ndae",
    "Brad",
    "Quah",
    "Rei",
    "Peter",
    "Kaz",
    "Kuda",
    "Quah",
    null,
    null,
    null,
    null,
  ],
  // Week 5
  [
    "Kaz",
    "Kuda",
    "Kuda",
    "(Other)",
    "(Other)",
    "Kaz",
    "Fara",
    "Kaz",
    "Kuda",
    "Rei",
    "Quah",
    "Rei",
    "Peter",
    null,
    null,
    null,
    null,
  ],
  // Week 6
  [
    "S'ndae",
    "Quah",
    "Peter",
    "Rei",
    "Peter",
    "Fara",
    "S'ndae",
    "Kuda",
    "Peter",
    "(Other)",
    "(Other)",
    "Quah",
    "Rei",
    null,
    null,
    null,
    null,
  ],
  // Week 7
  [
    "Rei",
    "Kaz",
    "Kuda",
    "Brad",
    "S'ndae",
    "Kuda",
    "Kuda",
    "Peter",
    "S'ndae",
    "Fara",
    "Brad",
    "Brad",
    "Kuda",
    null,
    null,
    null,
    null,
  ],
  // Week 8
  [
    "Peter",
    "Brad",
    "Fara",
    "Quah",
    "Kaz",
    "Peter",
    "Quah",
    "S'ndae",
    "Fara",
    "Brad",
    "S'ndae",
    "Brad",
    "Brad",
    null,
    null,
    null,
    null,
  ],
  // Week 9 — F1 + F2 only
  [
    "Kuda",
    "Rei",
    "Kaz",
    "S'ndae",
    "Peter",
    "S'ndae",
    "Rei",
    null,
    "Rei",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ],
  // Week 10
  [
    "Quah",
    "S'ndae",
    "S'ndae",
    "Kaz",
    "Kaz",
    "Peter",
    "Rei",
    null,
    "Kaz",
    "Kuda",
    "Fara",
    "Peter",
    "Kaz",
    null,
    null,
    null,
    null,
  ],
  // Week 11
  [
    "Brad",
    "Peter",
    "Brad",
    "Kuda",
    "Fara",
    "Quah",
    "Brad",
    null,
    "Kaz",
    "Kaz",
    "Quah",
    "Rei",
    "S'ndae",
    null,
    null,
    null,
    null,
  ],
  // Week 12 — F1 + F2 + F3 + F4 (first weapon)
  [
    "Kaz",
    "Fara",
    "Quah",
    "Peter",
    "Fara",
    "Brad",
    "Kaz",
    null,
    "Fara",
    "Quah",
    "Kuda",
    "Quah",
    "Peter",
    "Kaz",
    "Brad",
    null,
    "Fara",
  ],
  // Week 13 — F1 + F2 + F3 + F4 (second weapon)
  [
    "Kuda",
    "S'ndae",
    "Fara",
    "Rei",
    "Brad",
    "Kuda",
    "Fara",
    null,
    "Peter",
    "S'ndae",
    "Kaz",
    "Quah",
    "Brad",
    "Kuda",
    "S'ndae",
    null,
    "Rei",
  ],
];

// ─── Main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[import] using database ${databaseUrl}`);

  // 0. Rename the gear-tracker placeholder "The Black Mage" to the
  // canonical character name "Brad" the loot tab uses. Idempotent —
  // re-running the script is a no-op once the rename has happened.
  await client.execute({
    sql: "UPDATE player SET name = 'Brad' WHERE name = 'The Black Mage'",
    args: [],
  });

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

  // 4. Page adjustments per (player, tier, floor). The W9 gear-tracker
  // snapshot reported `Spent Pages` per floor — those pages were
  // already spent before this import script touched the DB, so we
  // negate them as `page_adjust` to keep the displayed balance
  // mathematically correct (`balance = kills + adjust − spent`,
  // where `spent` is the count of `paid_with_pages = true` drops).
  // Brad / The Black Mage carries an additional -2 across the first
  // three floors per the gear tracker's "Pages Adjust" column.
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

  // 5. Reset and re-import the per-tier raid weeks, boss kills, and
  // loot drops. This is the only destructive part of the script:
  // re-runs blow away the existing rows for this tier so the loot
  // tab is the single source of truth. UI-side edits to drops will
  // be lost on re-run, which is acceptable for a one-shot snapshot.
  await client.execute({
    sql: `DELETE FROM loot_drop WHERE raid_week_id IN
            (SELECT id FROM raid_week WHERE tier_id = ?)`,
    args: [tierId],
  });
  await client.execute({
    sql: `DELETE FROM boss_kill WHERE raid_week_id IN
            (SELECT id FROM raid_week WHERE tier_id = ?)`,
    args: [tierId],
  });
  await client.execute({
    sql: "DELETE FROM raid_week WHERE tier_id = ?",
    args: [tierId],
  });

  let totalDrops = 0;
  let totalKills = 0;
  for (const [weekIdx, recipients] of LOOT_HISTORY.entries()) {
    const weekNumber = weekIdx + 1;
    const insertedWeek = await client.execute({
      sql: `INSERT INTO raid_week (tier_id, week_number, started_at)
            VALUES (?, ?, unixepoch())
            RETURNING id`,
      args: [tierId, weekNumber],
    });
    const weekId = Number(insertedWeek.rows[0]?.id);
    if (!weekId)
      throw new Error(`[import] failed to insert week ${weekNumber}`);

    // Gather which floors had at least one recipient this week →
    // boss_kill rows. Note that the algorithm-untracked floor 4
    // still gets a kill row when a weapon was distributed; the
    // `tracked_for_algorithm` flag is on the floor, not on the kill,
    // so this stays consistent.
    const killedFloors = new Set<number>();
    for (let pos = 0; pos < recipients.length; pos += 1) {
      const cell = recipients[pos];
      const map = POSITION_TO_ITEM[pos];
      if (!cell || !map) continue;
      killedFloors.add(map.floor);
    }
    for (const floorNumber of killedFloors) {
      const floorId = floorIdByNumber.get(floorNumber);
      if (floorId === undefined) continue;
      await client.execute({
        sql: `INSERT INTO boss_kill (raid_week_id, floor_id, cleared_at)
              VALUES (?, ?, unixepoch())`,
        args: [weekId, floorId],
      });
      totalKills += 1;
    }

    // Insert one loot_drop per filled cell with a known mapping.
    for (let pos = 0; pos < recipients.length; pos += 1) {
      const cell = recipients[pos];
      const map = POSITION_TO_ITEM[pos];
      if (!cell || !map) continue;
      const floorId = floorIdByNumber.get(map.floor);
      if (floorId === undefined) continue;

      const recipientId =
        cell === "(Other)" ? null : (playerIdByName.get(cell) ?? null);
      if (cell !== "(Other)" && recipientId === null) {
        console.warn(
          `[import] week ${weekNumber} pos ${pos} (${map.itemKey}): unknown player "${cell}"`,
        );
      }

      await client.execute({
        sql: `INSERT INTO loot_drop
                (raid_week_id, floor_id, item_key, recipient_id,
                 paid_with_pages, picked_by_algorithm, score_snapshot,
                 notes, awarded_at)
              VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, unixepoch())`,
        args: [weekId, floorId, map.itemKey, recipientId],
      });
      totalDrops += 1;
    }
  }
  console.log(
    `[import] ${LOOT_HISTORY.length} weeks · ${totalKills} kills · ${totalDrops} drops`,
  );

  console.log("[import] done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
