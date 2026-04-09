import type { APIRoute } from 'astro'
import { createUser, createSession } from '../../../lib/db'

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const db = (locals as any).db
  if (!db) return new Response('Server error', { status: 500 })

  const form = await request.formData()
  const name = form.get('name')?.toString().trim()
  const email = form.get('email')?.toString().trim().toLowerCase()
  const password = form.get('password')?.toString()

  if (!name || !email || !password) {
    return Response.redirect(new URL('/registro?error=campos', request.url), 303)
  }
  if (password.length < 8) {
    return Response.redirect(new URL('/registro?error=password', request.url), 303)
  }

  try {
    const userId = await createUser(db, email, password, name)
    const token = await createSession(db, userId)
    cookies.set('session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 72 * 3600,
    })
    return Response.redirect(new URL('/app', request.url), 303)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return Response.redirect(new URL('/registro?error=existe', request.url), 303)
    }
    return Response.redirect(new URL('/registro?error=server', request.url), 303)
  }
}
