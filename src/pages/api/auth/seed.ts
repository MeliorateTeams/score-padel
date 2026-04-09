import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { hashPassword, generateId, generateSessionToken } from '../../../lib/auth'

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  if (secret !== 'scorepadel-seed-2026') {
    return new Response('Forbidden', { status: 403 })
  }

  const db = (env as any).DB
  if (!db) return new Response('No DB', { status: 500 })

  const results: string[] = []

  // Admin user
  try {
    const adminId = generateId()
    const adminHash = await hashPassword('Admin2026!')
    await db
      .prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
      .bind(adminId, 'admin@scorepadel.com', adminHash, 'Administrador', 'admin')
      .run()
    await db
      .prepare(
        'INSERT INTO profiles (user_id, rating, location, experience_years, bio) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(adminId, 5.0, 'Madrid, España', 10, 'Administrador de la plataforma Score Padel.')
      .run()
    results.push('Admin created: admin@scorepadel.com / Admin2026!')
  } catch (e: any) {
    results.push('Admin: ' + e.message)
  }

  // Guest user
  try {
    const guestId = generateId()
    const guestHash = await hashPassword('Guest2026!')
    await db
      .prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
      .bind(guestId, 'invitado@scorepadel.com', guestHash, 'Jugador Invitado', 'guest')
      .run()
    await db
      .prepare(
        'INSERT INTO profiles (user_id, rating, location, experience_years, bio) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(guestId, 2.5, 'Barcelona, España', 2, 'Cuenta de invitado para explorar la plataforma.')
      .run()
    results.push('Guest created: invitado@scorepadel.com / Guest2026!')
  } catch (e: any) {
    results.push('Guest: ' + e.message)
  }

  // Update existing test users to 'player' role explicitly
  try {
    await db.prepare("UPDATE users SET role = 'player' WHERE role IS NULL").run()
    results.push('Existing users updated to player role')
  } catch (e: any) {
    results.push('Role update: ' + e.message)
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
}
