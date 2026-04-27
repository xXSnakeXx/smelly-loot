-- v3.3.0 (1/3): per-tier slot priority weights for the loot
-- planner. Lower value = cheaper edge cost = the optimiser
-- prefers filling that slot first when multiple slots compete
-- for the same drop or material. NULL = use hard-coded defaults
-- from src/lib/ffxiv/slots.ts (DEFAULT_SLOT_WEIGHTS).
ALTER TABLE tier ADD COLUMN slot_weights TEXT;
