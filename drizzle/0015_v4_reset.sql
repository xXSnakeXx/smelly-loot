-- v4.0.0: drop the v3.3 slot/role weight columns and reset
-- every tier's loot history.
--
-- The greedy planner that replaces MCMF doesn't use slot or
-- role weights — bottleneck is computed dynamically from the
-- roster's open-need profile. Both columns are no longer
-- read by any code path.
--
-- The reset wipes every loot_drop, boss_kill, raid_week,
-- page_adjust and plan_cache row, then rolls every
-- bis_choice.current_source back to the v2 default (Crafted
-- on every real slot, NotPlanned on the per-job Offhand
-- exception). Pre-v4 drops were planned by a different
-- algorithm and equipping them retroactively under the new
-- bottleneck-aware logic would produce a state that doesn't
-- match what the new planner would have recommended. Cleaner
-- to start fresh — the operator sees the v4 plan from the
-- first render onward, with no leftover MCMF bias.
--
-- The roster (player rows + bis_choice rows) is preserved.
-- Only the per-tier loot history and the equipped-source
-- column on bis_choice are reset.
ALTER TABLE `tier` DROP COLUMN `slot_weights`;--> statement-breakpoint
ALTER TABLE `tier` DROP COLUMN `role_weights`;--> statement-breakpoint
DELETE FROM `loot_drop`;--> statement-breakpoint
DELETE FROM `boss_kill`;--> statement-breakpoint
DELETE FROM `raid_week`;--> statement-breakpoint
DELETE FROM `page_adjust`;--> statement-breakpoint
DELETE FROM `tier_plan_cache`;--> statement-breakpoint
UPDATE `bis_choice` SET `current_source` = 'Crafted' WHERE `current_source` <> 'NotPlanned';
