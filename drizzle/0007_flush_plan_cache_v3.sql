-- v3.0.0: flush all tier plan caches because the cache content
-- structure changed from `TimelineForFloor[]` (v2.x) to
-- `FloorPlan[]` (v3.x). The Plan UI and `getCachedOrComputePlan`
-- both have shape sanity-checks but flushing on container start
-- avoids any window where a v2 cache is read by v3 code.
DELETE FROM tier_plan_cache;
