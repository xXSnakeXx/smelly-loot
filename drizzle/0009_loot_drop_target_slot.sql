-- v3.2.0 (1/3): record which slot the awarded drop was equipped on.
-- NULL for pre-v3.2 rows where the action layer didn't auto-equip.
ALTER TABLE loot_drop ADD COLUMN target_slot TEXT;
