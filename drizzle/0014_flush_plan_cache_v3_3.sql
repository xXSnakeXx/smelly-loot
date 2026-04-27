-- v3.3.0 (3/3): flush every tier's plan cache so the next
-- render uses the new slot+role weighting in the network
-- construction. Pre-deploy caches don't reflect the bias.
DELETE FROM tier_plan_cache;
