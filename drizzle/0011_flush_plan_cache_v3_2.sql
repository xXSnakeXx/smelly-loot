-- v3.2.0 (3/3): flush every tier's plan cache because the action
-- layer now invalidates on award/undo, but pre-deploy caches
-- are still valid. Wipe so the new behaviour starts from a
-- clean baseline.
DELETE FROM tier_plan_cache;
