-- v3.1.0: flush every tier's plan cache because the FloorPlan
-- shape changed in v3.1 — `PlannedDrop` and `PlannedBuy` gained
-- a `source: "Savage" | "TomeUp"` discriminator + an `itemKey`
-- field on buys, and material drops (Glaze, Twine, Ester) now
-- get assigned recipients instead of falling through as
-- "unassigned". Pre-v3.1 caches are still parseable but the UI
-- expects the new fields, so we wipe and let the next page
-- render recompute.
DELETE FROM tier_plan_cache;
