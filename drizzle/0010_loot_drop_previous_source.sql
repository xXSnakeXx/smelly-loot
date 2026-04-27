-- v3.2.0 (2/3): record the bis_choice.current_source the recipient
-- had on `target_slot` BEFORE the drop, so undo and week-reset
-- can roll back. NULL for pre-v3.2 rows.
ALTER TABLE loot_drop ADD COLUMN previous_current_source TEXT;
