-- Add set_scores column to store individual set results as JSON
-- Example: [{"team1": 6, "team2": 4}, {"team1": 3, "team2": 6}, {"team1": 7, "team2": 5}]
ALTER TABLE matches ADD COLUMN set_scores TEXT DEFAULT '[]';
