-- 0003_team_scoped_players_with_tier_bis.sql
--
-- Migrate `player` back to team-scoped (reverting v1.4) and make
-- `bis_choice` tier-scoped via a new `tier_id` column.
--
-- v2.0 motivation:
--   - A raider's stable identity (name, main job, alt jobs, gear
--     tracker URL) doesn't change between tiers. Storing one row
--     per (player, tier) made cross-tier views require a name-join
--     and forced the same xivgear-link / notes maintenance 8x per
--     rollover. Reverting to team-scoped players fixes both.
--   - Per-tier data — the BiS plan and the loot history — moves
--     to (player, tier) composite keys. `bis_choice.tier_id` is
--     the new scoping column; tier membership is implicit (a
--     player IS in a tier iff at least one bis_choice row exists
--     for that pair).
--
-- Migration plan:
--   1. Build a player_id_map remapping duplicate (name, main_job)
--      rows to a single canonical id. The youngest id wins (=
--      most-recent tier the team played), since the youngest tier
--      has the freshest job assignment if a player main-swapped
--      between tiers.
--   2. Recreate `bis_choice` with the new (player_id, tier_id, slot)
--      composite primary key. Source rows are remapped through
--      player_id_map, and tier_id is derived from the pre-migration
--      `player.tier_id`.
--   3. Remap player references in `loot_drop.recipient_id` and
--      `page_adjust.player_id` to their canonical ids.
--   4. Recreate `player` with `team_id` instead of `tier_id`. Only
--      the canonical ids are kept; duplicate rows are dropped.
--   5. Drop the player_id_map helper table.
--
-- The `player_id_map` helper table is created on disk (rather than
-- TEMP) so its lifetime is unambiguously bound to the migration —
-- libsql migration statements may run across separate connections.
-- It's dropped at the end of the migration so production schemas
-- end up identical to fresh-deploy schemas.
--
-- `PRAGMA foreign_keys = OFF` is set for the duration of the
-- migration: dropping the old `player` table would otherwise
-- cascade-delete all of `bis_choice`, `loot_drop.recipient_id`, and
-- `page_adjust.player_id` even though we're about to repopulate
-- those references with the canonical ids. The pragma is restored
-- at the end.

PRAGMA foreign_keys = OFF;
--> statement-breakpoint

CREATE TABLE `player_id_map` (
    `old_id` integer PRIMARY KEY,
    `new_id` integer NOT NULL,
    `tier_id` integer NOT NULL,
    `team_id` integer NOT NULL
);
--> statement-breakpoint

INSERT INTO `player_id_map` (`old_id`, `new_id`, `tier_id`, `team_id`)
SELECT
    p.id AS old_id,
    (
        SELECT MAX(p2.id)
        FROM player p2
        JOIN tier t2 ON t2.id = p2.tier_id
        WHERE p2.name = p.name
          AND p2.main_job = p.main_job
          AND t2.team_id = t.team_id
    ) AS new_id,
    p.tier_id AS tier_id,
    t.team_id AS team_id
FROM player p
JOIN tier t ON t.id = p.tier_id;
--> statement-breakpoint

CREATE TABLE `bis_choice_v2` (
    `player_id` integer NOT NULL,
    `tier_id` integer NOT NULL,
    `slot` text NOT NULL,
    `desired_source` text DEFAULT 'NotPlanned' NOT NULL,
    `current_source` text DEFAULT 'NotPlanned' NOT NULL,
    `received_at` integer,
    `marker` text,
    PRIMARY KEY (`player_id`, `tier_id`, `slot`),
    FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (`tier_id`) REFERENCES `tier`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

INSERT INTO `bis_choice_v2` (
    `player_id`, `tier_id`, `slot`, `desired_source`, `current_source`,
    `received_at`, `marker`
)
SELECT
    m.new_id AS player_id,
    m.tier_id AS tier_id,
    bc.slot,
    bc.desired_source,
    bc.current_source,
    bc.received_at,
    bc.marker
FROM bis_choice bc
JOIN player_id_map m ON m.old_id = bc.player_id
WHERE NOT EXISTS (
    SELECT 1
    FROM bis_choice_v2 v
    WHERE v.player_id = m.new_id
      AND v.tier_id = m.tier_id
      AND v.slot = bc.slot
);
--> statement-breakpoint

DROP TABLE `bis_choice`;
--> statement-breakpoint

ALTER TABLE `bis_choice_v2` RENAME TO `bis_choice`;
--> statement-breakpoint

UPDATE `loot_drop`
SET `recipient_id` = (
    SELECT m.new_id
    FROM player_id_map m
    WHERE m.old_id = loot_drop.recipient_id
)
WHERE `recipient_id` IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM player_id_map m WHERE m.old_id = loot_drop.recipient_id
  );
--> statement-breakpoint

UPDATE `page_adjust`
SET `player_id` = (
    SELECT m.new_id
    FROM player_id_map m
    WHERE m.old_id = page_adjust.player_id
);
--> statement-breakpoint

CREATE TABLE `player_v2` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `team_id` integer NOT NULL,
    `name` text NOT NULL,
    `main_job` text NOT NULL,
    `alt_jobs` text DEFAULT (json_array()) NOT NULL,
    `gear_link` text,
    `notes` text,
    `sort_order` integer DEFAULT 0 NOT NULL,
    `created_at` integer DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

INSERT INTO `player_v2` (
    `id`, `team_id`, `name`, `main_job`, `alt_jobs`,
    `gear_link`, `notes`, `sort_order`, `created_at`
)
SELECT
    p.id,
    m.team_id,
    p.name,
    p.main_job,
    p.alt_jobs,
    p.gear_link,
    p.notes,
    p.sort_order,
    p.created_at
FROM player p
JOIN player_id_map m ON m.old_id = p.id
WHERE m.new_id = p.id;
--> statement-breakpoint

DROP INDEX IF EXISTS `player_tier_idx`;
--> statement-breakpoint

DROP TABLE `player`;
--> statement-breakpoint

ALTER TABLE `player_v2` RENAME TO `player`;
--> statement-breakpoint

CREATE INDEX `player_team_idx` ON `player` (`team_id`,`sort_order`);
--> statement-breakpoint

DROP TABLE `player_id_map`;
--> statement-breakpoint

PRAGMA foreign_keys = ON;
