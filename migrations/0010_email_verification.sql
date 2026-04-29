CREATE TABLE IF NOT EXISTS email_verifications (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  verified_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO email_verifications (user_id, verified_at, created_at, updated_at)
SELECT id, created_at, created_at, datetime('now')
FROM users;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_verified_at
ON email_verifications(verified_at);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires
ON email_verification_codes(expires_at);
