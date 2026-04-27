-- v2.5.1: flush every tier's plan cache so the next page render
-- recomputes against the new algorithm. Without this, an upgraded
-- container would still serve the v2.5.0 cached plan (with the
-- Bracelet-spillover bug) until the user clicked "Refresh Plan"
-- by hand.
--
-- Idempotent: deleting from an already-empty table is a no-op,
-- so re-running this migration on a fresh DB is safe.
DELETE FROM tier_plan_cache;
