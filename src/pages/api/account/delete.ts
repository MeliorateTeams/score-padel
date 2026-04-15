import type { APIRoute } from 'astro'
import { verifyPassword } from '../../../lib/auth'

// RGPD Art. 17 – Derecho de supresión ("derecho al olvido")
// El usuario puede eliminar su cuenta y todos sus datos personales.
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const user = (locals as any).user
  if (!user) return new Response('Unauthorized', { status: 401 })

  const db = (locals as any).db
  if (!db) return new Response('Server error', { status: 500 })

  const form = await request.formData()
  const password = form.get('password')?.toString()

  if (!password) {
    return new Response(JSON.stringify({ error: 'Se requiere la contraseña para confirmar.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Re-verify password before deletion
  const row = await db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string }>()

  if (!row) return new Response('Not found', { status: 404 })

  const valid = await verifyPassword(password, row.password_hash)
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Contraseña incorrecta.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Delete all user data in order (respecting foreign key logic)
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run()
  await db.prepare('DELETE FROM notifications WHERE user_id = ?').bind(user.id).run()
  await db.prepare('DELETE FROM rating_history WHERE user_id = ?').bind(user.id).run()
  await db.prepare('DELETE FROM match_confirmations WHERE user_id = ?').bind(user.id).run()
  await db
    .prepare('DELETE FROM challenges WHERE challenger_id = ? OR challenged_id = ?')
    .bind(user.id, user.id)
    .run()
  // Anonymize match participation instead of deleting (preserve other players' history)
  await db
    .prepare('UPDATE matches SET team1_player1 = NULL WHERE team1_player1 = ?')
    .bind(user.id)
    .run()
  await db
    .prepare('UPDATE matches SET team1_player2 = NULL WHERE team1_player2 = ?')
    .bind(user.id)
    .run()
  await db
    .prepare('UPDATE matches SET team2_player1 = NULL WHERE team2_player1 = ?')
    .bind(user.id)
    .run()
  await db
    .prepare('UPDATE matches SET team2_player2 = NULL WHERE team2_player2 = ?')
    .bind(user.id)
    .run()
  await db
    .prepare('DELETE FROM tournament_players WHERE user_id = ?')
    .bind(user.id)
    .run()
    .catch(() => null) // table may not exist in all schema versions
  await db.prepare('DELETE FROM profiles WHERE user_id = ?').bind(user.id).run()
  await db.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run()

  // Clear session cookie
  cookies.delete('session', { path: '/' })

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
