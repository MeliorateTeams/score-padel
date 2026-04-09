-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Player profiles
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  bio TEXT DEFAULT '',
  location TEXT DEFAULT '',
  experience_years INTEGER DEFAULT 0,
  racquet_sports TEXT DEFAULT '',
  rating REAL DEFAULT 1.0,
  matches_played INTEGER DEFAULT 0,
  matches_won INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

-- Tournaments
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  event_date TEXT NOT NULL,
  max_players INTEGER DEFAULT 16,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tournament registrations
CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (tournament_id, user_id)
);

-- Matches
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  tournament_id TEXT REFERENCES tournaments(id),
  date TEXT DEFAULT (datetime('now')),
  team1_player1 TEXT NOT NULL REFERENCES users(id),
  team1_player2 TEXT REFERENCES users(id),
  team2_player1 TEXT NOT NULL REFERENCES users(id),
  team2_player2 TEXT REFERENCES users(id),
  team1_sets INTEGER DEFAULT 0,
  team2_sets INTEGER DEFAULT 0,
  team1_games INTEGER DEFAULT 0,
  team2_games INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed',
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Rating history
CREATE TABLE IF NOT EXISTS rating_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  old_rating REAL NOT NULL,
  new_rating REAL NOT NULL,
  match_id TEXT NOT NULL REFERENCES matches(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_profiles_rating ON profiles(rating DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_location ON profiles(location);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_rating_history_user ON rating_history(user_id);
