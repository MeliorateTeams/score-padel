import type { APIRoute } from 'astro'
import { loginUser, createSession } from '../../../lib/db'

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const db = (locals as any).db
  if (!db) return new Response('Server error', { status: 500 })

  const form = await request.formData()
  const email = form.get('email')?.toString().trim().toLowerCase()
  const password = form.get('password')?.toString()

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
