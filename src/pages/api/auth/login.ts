import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { loginUser, createSession } from '../../../lib/db'

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = (env as any).TURNSTILE_SECRET
  if (!secret) return false // fail-closed: sin secret configurado, denegar
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
  })
  const data = (await res.json()) as { success: boolean }
  return data.success === true
}

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const db = (locals as any).db
  if (!db) return new Response('Server error', { status: 500 })

  const form = await request.formData()
  const email = form.get('email')?.toString().trim().toLowerCase()
  const password = form.get('password')?.toString()
  const turnstileToken = form.get('cf-turnstile-response')?.toString() ?? ''

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || ''
  const humanOk = await verifyTurnstile(turnstileToken, ip)
  if (!humanOk) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/login?error=captcha', request.url).toString() },
    })
  }

  if (!email || !password) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/login?error=campos', request.url).toString() },
    })
  }

  const userId = await loginUser(db, email, password)
  if (!userId) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/login?error=invalid', request.url).toString() },
    })
  }

  const token = await createSession(db, userId)
  cookies.set('session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 72 * 3600,
  })
  return new Response(null, {
    status: 303,
    headers: { Location: new URL('/app', request.url).toString() },
  })
}
