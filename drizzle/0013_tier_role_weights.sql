-- v3.3.0 (2/3): per-tier role priority weights for the loot
-- planner. Lower value = cheaper drop edges to that role's
-- NeedNodes. The defaults give DPS roles a 0.95 discount.
-- NULL = use hard-coded defaults from src/lib/ffxiv/jobs.ts
-- (DEFAULT_ROLE_WEIGHTS).
ALTER TABLE tier ADD COLUMN role_weights TEXT;
