import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Application-wide schema definitions.
 *
 * The schema is split into logical clusters by comment banner — Team /
 * Player → Tier / Floor / Costs → Loot tracking. Drizzle's API works
 * just as well in a single file as it does split across multiple, and
 * keeping everything here makes the foreign-key surface easy to audit
 * during reviews. Once the file passes ~600 LOC we'll consider
 * splitting (per the convention in fflogs-analyzer).
 *
 * Conventions used throughout:
 * - All timestamps live in `INTEGER` columns with Drizzle's
 *   `mode: "timestamp"` so the JS layer sees `Date` values.
 *   `default(sql\`(unixepoch())\`)` lets SQLite stamp them at insert time.
 * - Foreign keys cascade on delete by default; orphaned rows would be
 *   confusing to reason about and SQLite enforces them when
 *   `PRAGMA foreign_keys = ON` is set (libSQL does this by default).
 * - Composite primary keys use Drizzle's `primaryKey` helper.
 * - `text` columns store enum-like values; the application layer
 *   validates membership via Zod schemas before write. Adding a
 *   `CHECK` constraint is overkill for a v1 with a single trusted
 *   writer.
 */

// ─── Team / Player ─────────────────────────────────────────────────────

/**
 * A single static (raid team).
 *
 * Tier-rollover decision (v1.4): players are scoped to a tier rather
 * than a team. The team row stays as the top-level grouping so a
 * future deployment can host multiple teams; tiers + rosters then
 * hang off it.
 */
export const team = sqliteTable("team", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  locale: text("locale").notNull().default("en"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Team = typeof team.$inferSelect;
export type NewTeam = typeof team.$inferInsert;

/**
 * A single raider on a team's roster.
 *
 * `mainJob` is the four-character FF XIV job code (PLD, WHM, ...).
 * The mapping from job → gear role lives in `src/lib/ffxiv/jobs.ts`;
 * no `gear_role` column is stored because it's a pure derivation and
 * keeping it out of the schema means changing the role table is
 * effective immediately, with no migration.
 *
 * `altJobs` is a JSON array of job codes the player also raids on, for
 * the rare "I might main-swap mid-tier" scenarios.
 *
 * `gearLink` is the raw xivgear.app URL the player pasted.
 *
 * Players are **team-scoped** (v2.0). The roster of stable
 * identities lives once on the team — Brad is the same row whether
 * the team is mid-tier on Heavyweight or already prepping
 * Cruiserweight. Tier-specific data (gear plan, page balances,
 * loot history) hangs off `bis_choice`, `loot_drop`, and friends
 * via `(player_id, tier_id)` composite keys.
 *
 * The v1.4-era `tier_id` column was reverted in the v2.0 migration:
 * scoping players per tier turned out to make cross-tier history
 * harder than it was worth. Reusing the same `player.id` across
 * tiers also means xivgear-link / notes maintenance happens in one
 * place instead of 8x per rollover.
 */
export const player = sqliteTable(
  "player",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: integer("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mainJob: text("main_job").notNull(),
    altJobs: text("alt_jobs", { mode: "json" })
      .notNull()
      .$type<string[]>()
      .default(sql`(json_array())`),
    gearLink: text("gear_link"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("player_team_idx").on(t.teamId, t.sortOrder)],
);

export type Player = typeof player.$inferSelect;
export type NewPlayer = typeof player.$inferInsert;

/**
 * Per-(player, tier) BiS plan: which source they want for each slot.
 *
 * Composite primary key on (player, tier, slot) so a player has at
 * most one row per slot per tier — and importantly, two rows for
 * the same player+slot in different tiers (because each tier has
 * its own max iLv and the team replans on rollover).
 *
 * The `source` columns accept any value from `BIS_SOURCES` (see
 * `src/lib/ffxiv/slots.ts`); the application validates with Zod
 * before write.
 *
 * Two source columns are tracked: `desiredSource` is the BiS plan
 * (where the player wants the slot to land for *this* tier),
 * `currentSource` is what they're actually wearing right now. The
 * algorithm only cares about `desiredSource`, but the tracker UI
 * needs `currentSource` for colour-coded progress.
 *
 * Membership in a tier is implicit: if a player has any
 * `bis_choice` row for a tier, they are in that tier's roster.
 * That's why "add player to tier" stamps the 12-slot default plan
 * and "remove player from tier" deletes those rows — no separate
 * membership table is needed.
 */
export const bisChoice = sqliteTable(
  "bis_choice",
  {
    playerId: integer("player_id")
      .notNull()
      .references(() => player.id, { onDelete: "cascade" }),
    tierId: integer("tier_id")
      .notNull()
      .references(() => tier.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(),
    desiredSource: text("desired_source").notNull().default("NotPlanned"),
    currentSource: text("current_source").notNull().default("NotPlanned"),
    receivedAt: integer("received_at", { mode: "timestamp" }),
    marker: text("marker"),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.tierId, t.slot] })],
);

export type BisChoice = typeof bisChoice.$inferSelect;
export type NewBisChoice = typeof bisChoice.$inferInsert;

// ─── Tier / Floor / Costs ──────────────────────────────────────────────

/**
 * A raid tier (e.g. "Arcadion Heavyweight Savage").
 *
 * `archived_at` is set when the tier is closed for new loot but kept
 * read-only for history (Topic 7 decision). `max_ilv` is the only
 * mandatory user input at creation time; the per-source iLvs default
 * to `max_ilv + DEFAULT_ILV_DELTAS[source]` (see `src/lib/ffxiv/slots.ts`)
 * but each value is editable in case a future patch breaks the
 * pattern.
 *
 * The per-source iLv columns are denormalised on the tier row instead
 * of living in a per-source-iLv junction table. There are exactly nine
 * sources by design (eight from the spreadsheet + the synthetic
 * `NotPlanned`); flattening them to columns is dramatically easier to
 * read in SQL inspectors and avoids a join on every BiS render.
 */
export const tier = sqliteTable(
  "tier",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: integer("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    maxIlv: integer("max_ilv").notNull(),
    ilvSavage: integer("ilv_savage").notNull(),
    ilvTomeUp: integer("ilv_tome_up").notNull(),
    ilvCatchup: integer("ilv_catchup").notNull(),
    ilvTome: integer("ilv_tome").notNull(),
    ilvExtreme: integer("ilv_extreme").notNull(),
    ilvRelic: integer("ilv_relic").notNull(),
    ilvCrafted: integer("ilv_crafted").notNull(),
    ilvWhyyyy: integer("ilv_whyyyy").notNull(),
    ilvJustNo: integer("ilv_just_no").notNull(),
    /**
     * Per-slot priority multiplier for the min-cost-flow planner.
     * Lower value = cheaper edge cost = the optimiser prefers
     * filling that slot first when multiple slots compete for the
     * same drop / material. Default: chestpiece + pants get a
     * 0.85 discount (highest stat budget in FFXIV gear), weapon
     * gets a 0.80 discount, head gets 0.95, the rest stay at 1.0.
     *
     * Stored as JSON `Record<Slot, number>`. NULL on legacy rows;
     * the action layer falls back to `DEFAULT_SLOT_WEIGHTS` from
     * `src/lib/ffxiv/slots.ts` when reading.
     */
    slotWeights: text("slot_weights", { mode: "json" }).$type<
      Record<string, number>
    >(),
    /**
     * Per-role priority multiplier for the min-cost-flow planner.
     * Lower value = cheaper drop edges to that role's NeedNodes,
     * so the optimiser bias drops in their direction. Default
     * gives the three DPS roles a 0.95 discount; tank and healer
     * stay at 1.0. The user-facing tier-settings form lets the
     * raid leader tune these.
     *
     * The "ab 2 verbleibenden Items" cap the user described falls
     * out automatically: page-buy edges still exist for every
     * unfulfilled need, so once a DPS has only 2 slots left and
     * page-budget covers them, the optimiser routes drops to
     * other roles whose Page balance can't cover their remaining
     * needs.
     */
    roleWeights: text("role_weights", { mode: "json" }).$type<
      Record<string, number>
    >(),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("tier_team_idx").on(t.teamId, t.archivedAt)],
);

export type Tier = typeof tier.$inferSelect;
export type NewTier = typeof tier.$inferInsert;

/**
 * One floor (boss encounter) within a tier.
 *
 * `drops` is a JSON array of item keys (see `ITEM_KEYS` in
 * `src/lib/ffxiv/slots.ts`) listing every item that can drop or be
 * tracked from this floor. `tracked_for_algorithm = false` skips the
 * scoring engine for this floor (Topic 3 decision: floor 4 is logged
 * but not algorithmically distributed).
 *
 * `pageTokenLabel` is the in-game name of the per-floor page token
 * ("AAC Illustrated: HW Edition I" → "HW Edition I"). It's optional
 * because future tiers might use a different naming scheme.
 */
export const floor = sqliteTable(
  "floor",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tierId: integer("tier_id")
      .notNull()
      .references(() => tier.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    drops: text("drops", { mode: "json" }).notNull().$type<string[]>(),
    trackedForAlgorithm: integer("tracked_for_algorithm", { mode: "boolean" })
      .notNull()
      .default(true),
    pageTokenLabel: text("page_token_label"),
  },
  (t) => [uniqueIndex("floor_tier_number_uidx").on(t.tierId, t.number)],
);

export type Floor = typeof floor.$inferSelect;
export type NewFloor = typeof floor.$inferInsert;

/**
 * Per-tier item buy cost: how many of which floor's tokens it takes
 * to purchase a given item. Covers gear pieces *and* upgrade
 * materials — the algorithm's `effective_need` formula uses the same
 * lookup for both.
 *
 * Composite primary key on (tier, item_key); `floor_number` is a
 * regular column (1-4), not a foreign key to `floor.id`, because a
 * tier might want to retroactively repoint a buy cost to a different
 * floor without rewriting `floor.id` references.
 */
export const tierBuyCost = sqliteTable(
  "tier_buy_cost",
  {
    tierId: integer("tier_id")
      .notNull()
      .references(() => tier.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    floorNumber: integer("floor_number").notNull(),
    cost: integer("cost").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tierId, t.itemKey] })],
);

export type TierBuyCost = typeof tierBuyCost.$inferSelect;
export type NewTierBuyCost = typeof tierBuyCost.$inferInsert;

// ─── Loot tracking ─────────────────────────────────────────────────────

/**
 * One raid week in the context of a tier.
 *
 * `weekNumber` is a per-tier counter (1, 2, 3, …) so weekly views
 * stay readable across tier rollovers. The spreadsheet labels weeks
 * the same way.
 */
export const raidWeek = sqliteTable(
  "raid_week",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tierId: integer("tier_id")
      .notNull()
      .references(() => tier.id, { onDelete: "cascade" }),
    weekNumber: integer("week_number").notNull(),
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("week_tier_number_uidx").on(t.tierId, t.weekNumber)],
);

export type RaidWeek = typeof raidWeek.$inferSelect;
export type NewRaidWeek = typeof raidWeek.$inferInsert;

/**
 * One boss kill within a raid week.
 *
 * Page accumulation flows from this table: every player attached to
 * the parent team gets `+1` page of the floor's token for every
 * `boss_kill` row. Spending pages (`paid_with_pages = true` on a
 * `loot_drop`) decrements the balance. The algorithm computes
 * everything per-render so the persisted state stays minimal.
 */
export const bossKill = sqliteTable(
  "boss_kill",
  {
    raidWeekId: integer("raid_week_id")
      .notNull()
      .references(() => raidWeek.id, { onDelete: "cascade" }),
    floorId: integer("floor_id")
      .notNull()
      .references(() => floor.id, { onDelete: "cascade" }),
    clearedAt: integer("cleared_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.raidWeekId, t.floorId] })],
);

export type BossKill = typeof bossKill.$inferSelect;
export type NewBossKill = typeof bossKill.$inferInsert;

/**
 * One loot drop assigned to a player (or unassigned).
 *
 * `pickedByAlgorithm` records whether the recommendation was accepted
 * as-is (`true`) or overridden manually (`false`). The full score
 * snapshot of the time of decision is persisted in `scoreSnapshot`
 * so the UI can render historical breakdowns even after the algorithm
 * is tweaked. `paidWithPages` flips the meaning: instead of "this is
 * a boss drop", the row records "this player spent floor tokens to
 * buy the item" — useful for the page-counter view and to keep the
 * gear tracker complete.
 *
 * `recipientId` is nullable because a drop can also fall to an
 * unattached recipient (PUG, the floor, etc.); the spreadsheet has a
 * "Notes" column for those cases that we surface here.
 */
export const lootDrop = sqliteTable(
  "loot_drop",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    raidWeekId: integer("raid_week_id")
      .notNull()
      .references(() => raidWeek.id, { onDelete: "cascade" }),
    floorId: integer("floor_id")
      .notNull()
      .references(() => floor.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    recipientId: integer("recipient_id").references(() => player.id, {
      onDelete: "set null",
    }),
    paidWithPages: integer("paid_with_pages", { mode: "boolean" })
      .notNull()
      .default(false),
    pickedByAlgorithm: integer("picked_by_algorithm", { mode: "boolean" })
      .notNull()
      .default(false),
    /**
     * The slot the drop was equipped onto, if any. NULL when the
     * drop was awarded before v3.2 (which introduced auto-equip),
     * or when no compatible unmet slot was found at award time.
     * Used by `undoLootDropAction` and `resetWeekAction` to know
     * which `bis_choice` row to roll back.
     */
    targetSlot: text("target_slot"),
    /**
     * The `bis_choice.current_source` value the recipient had on
     * `target_slot` BEFORE the drop was awarded. Used by undo and
     * week-reset to restore the prior state. NULL for pre-v3.2
     * drops.
     */
    previousCurrentSource: text("previous_current_source"),
    scoreSnapshot: text("score_snapshot", { mode: "json" }).$type<unknown>(),
    notes: text("notes"),
    awardedAt: integer("awarded_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("loot_week_floor_idx").on(t.raidWeekId, t.floorId),
    index("loot_recipient_idx").on(t.recipientId),
  ],
);

export type LootDrop = typeof lootDrop.$inferSelect;
export type NewLootDrop = typeof lootDrop.$inferInsert;

/**
 * Per-player, per-floor adjustment used to correct page counts in
 * edge cases the auto-derivation can't see (player joined mid-tier
 * with carry-over, missed a week before the app was deployed, pages
 * earned from coffers, alliance raids, etc.). Composite primary key
 * on (player, tier, floor_number) so each combination has at most one
 * row.
 *
 * `delta` is a signed integer; +N means "add N pages of that floor
 * for this player", −N means "subtract N".
 */
export const pageAdjust = sqliteTable(
  "page_adjust",
  {
    playerId: integer("player_id")
      .notNull()
      .references(() => player.id, { onDelete: "cascade" }),
    tierId: integer("tier_id")
      .notNull()
      .references(() => tier.id, { onDelete: "cascade" }),
    floorNumber: integer("floor_number").notNull(),
    delta: integer("delta").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.tierId, t.floorNumber] })],
);

export type PageAdjust = typeof pageAdjust.$inferSelect;
export type NewPageAdjust = typeof pageAdjust.$inferInsert;

/**
 * Persistent cache for the per-tier Plan-tab simulation.
 *
 * The Track / Roster / History tabs stay live — their server
 * actions still fire `revalidatePath` and the corresponding
 * components re-render on every kill / drop / roster mutation. The
 * Plan tab is intentionally NOT live: its recommended-recipient
 * list is sticky until the user explicitly clicks Refresh, so
 * casual interactions on Track don't reshuffle the next few weeks
 * of plans under their feet.
 *
 * One row per tier. `snapshot` is the JSON-serialised array of
 * `FloorPlan` entries (v3.0+, was `TimelineForFloor` in v2.x) the
 * Plan UI renders directly; `computed_at` is shown in the UI as
 * "last refreshed N minutes ago" so the operator can decide if the
 * cache is still meaningful.
 */
export const tierPlanCache = sqliteTable("tier_plan_cache", {
  tierId: integer("tier_id")
    .primaryKey()
    .references(() => tier.id, { onDelete: "cascade" }),
  snapshot: text("snapshot").notNull(),
  computedAt: integer("computed_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type TierPlanCache = typeof tierPlanCache.$inferSelect;
export type NewTierPlanCache = typeof tierPlanCache.$inferInsert;
