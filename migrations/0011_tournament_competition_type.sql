CREATE TABLE IF NOT EXISTS tournament_competition_types (
  tournament_id TEXT PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
  competition_type TEXT NOT NULL DEFAULT 'tournament',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO tournament_competition_types (tournament_id, competition_type)
SELECT id, 'tournament'
FROM tournaments;

CREATE INDEX IF NOT EXISTS idx_tournament_competition_type
ON tournament_competition_types(competition_type);
