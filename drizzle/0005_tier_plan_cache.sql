-- 0005_tier_plan_cache.sql
--
-- Persistent cache for the per-tier Plan-tab simulation result.
--
-- Pre-v2.3 the Plan tab recomputed the simulation on every server
-- render, which meant every BiS edit / kill toggle / drop award
-- (each of which fires `revalidatePath`) shifted the recommended
-- recipients in real time. The user feedback was that the Plan tab
-- felt unstable: any tracked-tab interaction reshuffled the next
-- few weeks of recommendations.
--
-- v2.3 splits the two timelines: Track / Roster / History stay
-- live (their `revalidatePath` calls keep firing) but the Plan tab
-- caches its computation here and only refreshes when the user
-- explicitly clicks the Refresh button. The cache survives server
-- restarts, so the Plan tab opens to whatever the operator last
-- accepted as "the plan" — no surprises after a deploy.
--
-- `snapshot` holds the JSON-serialised array of `TimelineForFloor`
-- entries the Plan tab renders. Schema is per-tier (one row per
-- tier_id) because the Plan tab is tier-scoped.

CREATE TABLE `tier_plan_cache` (
    `tier_id` integer PRIMARY KEY NOT NULL,
    `snapshot` text NOT NULL,
    `computed_at` integer NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (`tier_id`) REFERENCES `tier`(`id`) ON UPDATE no action ON DELETE cascade
);
