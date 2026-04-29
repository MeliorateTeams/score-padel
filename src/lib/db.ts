import type { D1Database } from '@cloudflare/workers-types'
import {
  generateId,
  generateSessionToken,
  generateVerificationCode,
  generateVerificationSalt,
  hashPassword,
  hashVerificationCode,
  timingSafeEqualText,
  verifyPassword,
} from './auth'

export interface User {
  id: string
  email: string
  name: string
  role: string
  created_at: string
}

export interface Profile {
  user_id: string
  bio: string
  location: string
  experience_years: number
  racquet_sports: string
  rating: number
  matches_played: number
  matches_won: number
  birth_date: string
  gender: string
}

const SESSION_DURATION_HOURS = 72
const EMAIL_VERIFICATION_CODE_EXPIRY_MINUTES = 15
const EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5
const OPTIONAL_TABLE_CACHE = new Map<string, boolean>()

export interface LoginUserResult {
  id: string
  emailVerifiedAt: string | null
}

export interface UserEmailVerificationState {
  userId: string
  email: string
  name: string
  verifiedAt: string | null
}

export type VerifyEmailCodeStatus =
  | 'verified'
  | 'already_verified'
  | 'invalid'
  | 'expired'
  | 'too_many_attempts'
  | 'not_found'

export interface VerifyEmailCodeResult {
  status: VerifyEmailCodeStatus
  userId?: string
}

function formatSqliteDate(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

function secondsUntil(dateString: string): number {
  const target = Date.parse(dateString.replace(' ', 'T') + 'Z')
  if (Number.isNaN(target)) return 0
  return Math.max(0, Math.ceil((target - Date.now()) / 1000))
}

async function hasOptionalTable(db: D1Database, tableName: string): Promise<boolean> {
  const cached = OPTIONAL_TABLE_CACHE.get(tableName)
  if (cached !== undefined) return cached

  try {
    const row = await db
      .prepare("SELECT 1 as present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .bind(tableName)
      .first<{ present: number }>()
    const present = !!row?.present
    OPTIONAL_TABLE_CACHE.set(tableName, present)
    return present
  } catch {
    OPTIONAL_TABLE_CACHE.set(tableName, false)
    return false
  }
}

export async function createUser(
  db: D1Database,
  email: string,
  password: string,
  name: string,
  options?: { emailVerified?: boolean },
) {
  const id = generateId()
  const password_hash = await hashPassword(password)
  const verifiedAt = options?.emailVerified === false ? null : formatSqliteDate(new Date())
  await db
    .prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
    .bind(id, email, password_hash, name)
    .run()
  await db.prepare('INSERT INTO profiles (user_id) VALUES (?)').bind(id).run()
  if (await hasOptionalTable(db, 'email_verifications')) {
    await db
      .prepare('INSERT INTO email_verifications (user_id, verified_at) VALUES (?, ?)')
      .bind(id, verifiedAt)
      .run()
  }
  return id
}

export async function loginUser(
  db: D1Database,
  email: string,
  password: string,
): Promise<LoginUserResult | null> {
  const row = (await hasOptionalTable(db, 'email_verifications'))
    ? await db
        .prepare(
          `
          SELECT
            u.id,
            u.password_hash,
            CASE WHEN ev.user_id IS NULL THEN u.created_at ELSE ev.verified_at END AS email_verified_at
          FROM users u
          LEFT JOIN email_verifications ev ON ev.user_id = u.id
          WHERE u.email = ?
        `,
        )
        .bind(email)
        .first<{ id: string; password_hash: string; email_verified_at: string | null }>()
    : await db
        .prepare(
          'SELECT id, password_hash, created_at as email_verified_at FROM users WHERE email = ?',
        )
        .bind(email)
        .first<{ id: string; password_hash: string; email_verified_at: string | null }>()
  if (!row) return null
  const valid = await verifyPassword(password, row.password_hash)
  if (!valid) return null
  return {
    id: row.id,
    emailVerifiedAt: row.email_verified_at,
  }
}

export async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = generateSessionToken()
  // Formato compatible con datetime('now') de SQLite: YYYY-MM-DD HH:MM:SS
  const expires = formatSqliteDate(new Date(Date.now() + SESSION_DURATION_HOURS * 3600000))
  await db
    .prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expires)
    .run()
  return token
}

export async function getSession(db: D1Database, token: string): Promise<User | null> {
  const row = await db
    .prepare(
      `
    SELECT u.id, u.email, u.name, u.role, u.created_at FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now') AND u.role != 'suspended'
  `,
    )
    .bind(token)
    .first<User>()
  return row ?? null
}

export async function deleteSession(db: D1Database, token: string) {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run()
}

export async function getUserEmailVerificationState(
  db: D1Database,
  email: string,
): Promise<UserEmailVerificationState | null> {
  const row = (await hasOptionalTable(db, 'email_verifications'))
    ? await db
        .prepare(
          `
          SELECT
            u.id AS userId,
            u.email,
            u.name,
            CASE WHEN ev.user_id IS NULL THEN u.created_at ELSE ev.verified_at END AS verifiedAt
          FROM users u
          LEFT JOIN email_verifications ev ON ev.user_id = u.id
          WHERE u.email = ?
        `,
        )
        .bind(email)
        .first<UserEmailVerificationState>()
    : await db
        .prepare(
          'SELECT id as userId, email, name, created_at as verifiedAt FROM users WHERE email = ?',
        )
        .bind(email)
        .first<UserEmailVerificationState>()
  return row ?? null
}

export async function getVerificationResendRetrySeconds(
  db: D1Database,
  userId: string,
): Promise<number> {
  if (!(await hasOptionalTable(db, 'email_verification_codes'))) return 0

  const row = await db
    .prepare('SELECT last_sent_at FROM email_verification_codes WHERE user_id = ?')
    .bind(userId)
    .first<{ last_sent_at: string }>()
  if (!row?.last_sent_at) return 0
  const lastSentAt = Date.parse(row.last_sent_at.replace(' ', 'T') + 'Z')
  if (Number.isNaN(lastSentAt)) return 0
  const retryAt = new Date(lastSentAt + EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000)
  return secondsUntil(formatSqliteDate(retryAt))
}

export async function createEmailVerificationChallenge(
  db: D1Database,
  userId: string,
): Promise<{ code: string; expiresAt: string }> {
  if (!(await hasOptionalTable(db, 'email_verification_codes'))) {
    throw new Error('EMAIL_VERIFICATION_SCHEMA_MISSING')
  }

  const code = generateVerificationCode()
  const salt = generateVerificationSalt()
  const codeHash = await hashVerificationCode(code, salt)
  const now = new Date()
  const sentAt = formatSqliteDate(now)
  const expiresAt = formatSqliteDate(
    new Date(now.getTime() + EMAIL_VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000),
  )

  await db
    .prepare(
      `
      INSERT INTO email_verification_codes (user_id, code_hash, code_salt, expires_at, attempts, last_sent_at)
      VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        code_hash = excluded.code_hash,
        code_salt = excluded.code_salt,
        expires_at = excluded.expires_at,
        attempts = 0,
        last_sent_at = excluded.last_sent_at,
        created_at = datetime('now')
    `,
    )
    .bind(userId, codeHash, salt, expiresAt, sentAt)
    .run()

  return { code, expiresAt }
}

export async function verifyEmailCode(
  db: D1Database,
  email: string,
  code: string,
): Promise<VerifyEmailCodeResult> {
  if (
    !(await hasOptionalTable(db, 'email_verifications')) ||
    !(await hasOptionalTable(db, 'email_verification_codes'))
  ) {
    return { status: 'not_found' }
  }

  const row = await db
    .prepare(
      `
      SELECT
        u.id AS userId,
        ev.verified_at AS verifiedAt,
        vc.code_hash AS codeHash,
        vc.code_salt AS codeSalt,
        vc.expires_at AS expiresAt,
        vc.attempts AS attempts
      FROM users u
      LEFT JOIN email_verifications ev ON ev.user_id = u.id
      LEFT JOIN email_verification_codes vc ON vc.user_id = u.id
      WHERE u.email = ?
    `,
    )
    .bind(email)
    .first<{
      userId: string
      verifiedAt: string | null
      codeHash: string | null
      codeSalt: string | null
      expiresAt: string | null
      attempts: number | null
    }>()

  if (!row) return { status: 'not_found' }
  if (row.verifiedAt) return { status: 'already_verified', userId: row.userId }
  if (!row.codeHash || !row.codeSalt || !row.expiresAt) return { status: 'expired' }
  if ((row.attempts ?? 0) >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
    return { status: 'too_many_attempts' }
  }
  if (secondsUntil(row.expiresAt) === 0) {
    return { status: 'expired' }
  }

  const providedHash = await hashVerificationCode(code, row.codeSalt)
  if (!timingSafeEqualText(providedHash, row.codeHash)) {
    await db
      .prepare('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE user_id = ?')
      .bind(row.userId)
      .run()

    if ((row.attempts ?? 0) + 1 >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      return { status: 'too_many_attempts' }
    }
    return { status: 'invalid' }
  }

  const verifiedAt = formatSqliteDate(new Date())
  await db.batch([
    db
      .prepare(
        `
        INSERT INTO email_verifications (user_id, verified_at, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          verified_at = excluded.verified_at,
          updated_at = excluded.updated_at
      `,
      )
      .bind(row.userId, verifiedAt, verifiedAt),
    db.prepare('DELETE FROM email_verification_codes WHERE user_id = ?').bind(row.userId),
  ])

  return { status: 'verified', userId: row.userId }
}

export async function getProfile(db: D1Database, userId: string): Promise<Profile | null> {
  return (
    (await db.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(userId).first<Profile>()) ??
    null
  )
}

// Whitelist of allowed profile columns to prevent SQL injection via dynamic field names
const ALLOWED_PROFILE_FIELDS = new Set<string>([
  'bio',
  'location',
  'experience_years',
  'racquet_sports',
  'rating',
  'matches_played',
  'matches_won',
  'birth_date',
  'gender',
])

export async function updateProfile(db: D1Database, userId: string, data: Partial<Profile>) {
  const fields: string[] = []
  const values: unknown[] = []
  for (const [k, v] of Object.entries(data)) {
    if (ALLOWED_PROFILE_FIELDS.has(k) && v !== undefined) {
      fields.push(`${k} = ?`)
      values.push(v)
    }
  }
  if (fields.length === 0) return
  fields.push("updated_at = datetime('now')")
  values.push(userId)
  await db
    .prepare(`UPDATE profiles SET ${fields.join(', ')} WHERE user_id = ?`)
    .bind(...values)
    .run()
}
