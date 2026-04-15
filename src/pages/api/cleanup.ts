import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'

// Constant-time string comparison to prevent timing attacks on secrets
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export const GET: APIRoute = async ({ locals, request }) => {
  const db = (locals as any).db
  if (!db) return new Response('DB unavailable', { status: 500 })

  // Verify admin via session or cron secret (stored as Cloudflare Worker secret)
  const user = (locals as any).user
  const authHeader = request.headers.get('authorization')
  const cronSecret = authHeader?.replace('Bearer ', '')
  const expectedSecret = (env as any).CRON_SECRET

  // Allow access only for admins or with valid cron secret
  if (!user || user.role !== 'admin') {
    if (!expectedSecret || !cronSecret || !timingSafeEqual(cronSecret, expectedSecret)) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  // Clean expired sessions
  const sessions = await db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run()

  // Clean old read notifications (> 30 days)
  const notifications = await db
    .prepare(
      "DELETE FROM notifications WHERE read = 1 AND created_at < datetime('now', '-30 days')",
    )
    .run()

  // Clean expired/rejected challenges (> 7 days old)
  const challenges = await db
    .prepare(
      "DELETE FROM challenges WHERE status != 'pending' AND created_at < datetime('now', '-7 days')",
    )
    .run()

  return new Response(
    JSON.stringify({
      ok: true,
      cleaned: {
        expired_sessions: sessions.meta?.changes ?? 0,
        old_notifications: notifications.meta?.changes ?? 0,
        old_challenges: challenges.meta?.changes ?? 0,
      },
      timestamp: new Date().toISOString(),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
}
