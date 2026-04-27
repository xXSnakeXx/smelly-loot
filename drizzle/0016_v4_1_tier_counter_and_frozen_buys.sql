-- v4.1.0: tier-counter fairness + frozen buys.
--
-- Two structural changes:
--
-- 1. `tier_player_stats(tier_id, player_id, drop_count)` —
--    persistent counter for the v4.1 fairness mechanism. The
--    Greedy-Planner's non-bottleneck score is purely
--    counter-driven, replacing the v4.0 within-week-fairness
--    score. Counter increments on drops only (not buys); see
--    schema.ts docstring for the detailed semantics.
--
-- 2. `tier.frozen_buys` (JSON) — once the planner runs for the
--    first time on a tier, the buy-set is frozen. Subsequent
--    refreshes only recompute the drop schedule; buys stay put
--    until the operator explicitly clicks "refreeze buys" in
--    Tier-Settings. See `refreezeBuysAction` for the trigger.
--
-- The plan cache is flushed unconditionally so the next render
-- runs the v4.1 score functions (which differ in behavior from
-- v4.0 for non-bottleneck items).
CREATE TABLE `tier_player_stats` (
	`tier_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`drop_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`tier_id`, `player_id`),
	FOREIGN KEY (`tier_id`) REFERENCES `tier`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint

-- Backfill from existing loot_drops. Only counts drops
-- (paid_with_pages = 0), not buys, matching the v4.1 counter
-- semantics. Players with zero historical drops get no row
-- (default value 0 is implied when reading).
INSERT INTO `tier_player_stats` (`tier_id`, `player_id`, `drop_count`)
SELECT
	rw.tier_id,
	ld.recipient_id,
	COUNT(*)
FROM `loot_drop` ld
INNER JOIN `raid_week` rw ON ld.raid_week_id = rw.id
WHERE ld.recipient_id IS NOT NULL
  AND ld.paid_with_pages = 0
GROUP BY rw.tier_id, ld.recipient_id;--> statement-breakpoint

ALTER TABLE `tier` ADD COLUMN `frozen_buys` text;--> statement-breakpoint

DELETE FROM `tier_plan_cache`;
