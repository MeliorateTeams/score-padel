import type { APIRoute } from 'astro'
import { createUser, createSession } from '../../../lib/db'

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const db = (locals as any).db
  if (!db) return new Response('Server error', { status: 500 })

  const form = await request.formData()
  const name = form.get('name')?.toString().trim()
  const email = form.get('email')?.toString().trim().toLowerCase()
  const password = form.get('password')?.toString()
  const privacy = form.get('privacy')

  if (!name || !email || !password) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/registro?error=campos', request.url).toString() },
    })
  }

  const allowedDomains = [
    'gmail.com',
    'outlook.com',
    'outlook.es',
    'hotmail.com',
    'hotmail.es',
    'yahoo.com',
    'yahoo.es',
    'icloud.com',
    'live.com',
  ]
  const emailDomain = email.split('@')[1]
  if (!emailDomain || !allowedDomains.includes(emailDomain)) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/registro?error=email', request.url).toString() },
    })
  }

  if (!privacy) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/registro?error=privacidad', request.url).toString() },
    })
  }
  if (password.length < 8) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/registro?error=password', request.url).toString() },
    })
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
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/app', request.url).toString() },
    })
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return new Response(null, {
        status: 303,
        headers: { Location: new URL('/registro?error=existe', request.url).toString() },
      })
    }
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/registro?error=server', request.url).toString() },
    })
  }
}
