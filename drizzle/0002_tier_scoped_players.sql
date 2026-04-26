-- 0002_tier_scoped_players.sql
--
-- Migrate `player` from team-scoped to tier-scoped.
--
-- v1.4 makes each tier its own roster so "Brad in tier A" and "Brad
-- in tier B" are formally separate identities. Cross-tier history is
-- recovered via player.name joins, not by foreign key.
--
-- The migration recreates the table because SQLite can't drop a
-- foreign-key column in place. The backfill picks the tier each
-- player has the most activity in:
--
--   1. The tier they have the most `page_adjust` rows in (the
--      strongest per-(player,tier) signal we have, since page
--      balances are explicitly tier-scoped).
--   2. Otherwise the team's earliest-created tier — that puts
--      legacy players who never raided onto the original Heavyweight
--      / Cruiserweight tier instead of a later rollover.

CREATE TABLE `player_v14` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `tier_id` integer NOT NULL,
    `name` text NOT NULL,
    `main_job` text NOT NULL,
    `alt_jobs` text DEFAULT (json_array()) NOT NULL,
    `gear_link` text,
    `notes` text,
    `sort_order` integer DEFAULT 0 NOT NULL,
    `created_at` integer DEFAULT (unixepoch()) NOT NULL,
    FOREIGN KEY (`tier_id`) REFERENCES `tier`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

INSERT INTO `player_v14` (
    `id`, `tier_id`, `name`, `main_job`, `alt_jobs`,
    `gear_link`, `notes`, `sort_order`, `created_at`
)
SELECT
    p.id,
    COALESCE(
        (
            SELECT pa.tier_id
            FROM page_adjust pa
            WHERE pa.player_id = p.id
            GROUP BY pa.tier_id
            ORDER BY count(*) DESC, pa.tier_id ASC
            LIMIT 1
        ),
        (
            SELECT t.id
            FROM tier t
            WHERE t.team_id = p.team_id
            ORDER BY t.created_at ASC
            LIMIT 1
        )
    ) AS tier_id,
    p.name,
    p.main_job,
    p.alt_jobs,
    p.gear_link,
    p.notes,
    p.sort_order,
    p.created_at
FROM player p;
--> statement-breakpoint

DROP INDEX IF EXISTS `player_team_idx`;
--> statement-breakpoint
DROP TABLE `player`;
--> statement-breakpoint
ALTER TABLE `player_v14` RENAME TO `player`;
--> statement-breakpoint

CREATE INDEX `player_tier_idx` ON `player` (`tier_id`,`sort_order`);
