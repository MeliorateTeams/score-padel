import type { APIRoute } from 'astro'
import { loginUser, createSession } from '../../../lib/db'

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const db = (locals as any).db
  if (!db) return new Response('Server error', { status: 500 })

  const form = await request.formData()
  const email = form.get('email')?.toString().trim().toLowerCase()
  const password = form.get('password')?.toString()

  if (!email || !password) {
    return Response.redirect(new URL('/login?error=campos', request.url), 303)
  }

  const userId = await loginUser(db, email, password)
  if (!userId) {
    return Response.redirect(new URL('/login?error=invalid', request.url), 303)
  }

  const token = await createSession(db, userId)
  cookies.set('session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 72 * 3600,
  })
  return Response.redirect(new URL('/app', request.url), 303)
}
