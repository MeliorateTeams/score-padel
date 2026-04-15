-- Add event_date and location to matches for create/result split flow
-- status column already exists from 0001_init.sql with default 'completed'
ALTER TABLE matches ADD COLUMN event_date TEXT;
ALTER TABLE matches ADD COLUMN location TEXT;
