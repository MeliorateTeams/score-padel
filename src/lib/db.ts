import type { D1Database } from '@cloudflare/workers-types'
import { hashPassword, verifyPassword, generateId, generateSessionToken } from './auth'

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

export async function createUser(db: D1Database, email: string, password: string, name: string) {
  const id = generateId()
  const password_hash = await hashPassword(password)
  await db
    .prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
    .bind(id, email, password_hash, name)
    .run()
  await db.prepare('INSERT INTO profiles (user_id) VALUES (?)').bind(id).run()
  return id
}

export async function loginUser(db: D1Database, email: string, password: string) {
  const row = await db
    .prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; password_hash: string }>()
  if (!row) return null
  const valid = await verifyPassword(password, row.password_hash)
  if (!valid) return null
  return row.id
}

export async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = generateSessionToken()
  const expires = new Date(Date.now() + SESSION_DURATION_HOURS * 3600000).toISOString()
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
    WHERE s.id = ? AND s.expires_at > datetime('now')
  `,
    )
    .bind(token)
    .first<User>()
  return row ?? null
}

export async function deleteSession(db: D1Database, token: string) {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run()
}

export async function getProfile(db: D1Database, userId: string): Promise<Profile | null> {
  return (
    (await db.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(userId).first<Profile>()) ??
    null
  )
}

export async function updateProfile(db: D1Database, userId: string, data: Partial<Profile>) {
  const fields: string[] = []
  const values: unknown[] = []
  for (const [k, v] of Object.entries(data)) {
    if (k !== 'user_id' && v !== undefined) {
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
