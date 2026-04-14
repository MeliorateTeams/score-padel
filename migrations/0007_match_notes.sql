-- Add notes field to matches for optional comments
ALTER TABLE matches ADD COLUMN notes TEXT DEFAULT '';
