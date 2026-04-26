-- 0004_update_default_extreme_crafted_ilvs.sql
--
-- Update the per-source iLv defaults for `Extreme` and `Crafted`:
--
--   - Extreme: max - 20  →  max - 15
--   - Crafted: max - 25  →  max - 20
--
-- Reflects the team's revised reading of where these gear tiers
-- actually sit relative to the Savage cap. Crafted now shares
-- `max - 20` with Relic; Extreme moves up between the
-- Catchup/Tome (max - 10) line and the Crafted/Relic (max - 20)
-- line.
--
-- Only tiers whose stored values still match the *old* defaults
-- get updated — if someone has manually customised either field
-- the override is preserved. The match is computed against
-- `max_ilv` per row so the rule scales to any tier's iLv cap.

UPDATE tier
SET ilv_extreme = max_ilv - 15
WHERE ilv_extreme = max_ilv - 20;
--> statement-breakpoint

UPDATE tier
SET ilv_crafted = max_ilv - 20
WHERE ilv_crafted = max_ilv - 25;
