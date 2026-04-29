import type { APIRoute } from 'astro'
import { createSession, verifyEmailCode } from '../../../lib/db'

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const db = (locals as any).db
  if (!db) return new Response('Server error', { status: 500 })

  const form = await request.formData()
  const email = form.get('email')?.toString().trim().toLowerCase() ?? ''
  const code = form.get('code')?.toString().trim() ?? ''

  if (!email || !/^\d{6}$/.test(code)) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL(
          `/verificar-email?email=${encodeURIComponent(email)}&error=campos`,
          request.url,
        ).toString(),
      },
    })
  }

  try {
    const result = await verifyEmailCode(db, email, code)
    if (result.status === 'verified') {
      const token = await createSession(db, result.userId)
      cookies.set('session', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 72 * 3600,
      })

      return new Response(null, {
        status: 303,
        headers: { Location: new URL('/app/cuestionario', request.url).toString() },
      })
    }

    if (result.status === 'already_verified') {
      return new Response(null, {
        status: 303,
        headers: { Location: new URL('/login?verified=1', request.url).toString() },
      })
    }

    const error =
      result.status === 'expired' || result.status === 'too_many_attempts' ? 'expired' : 'invalid'

    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL(
          `/verificar-email?email=${encodeURIComponent(email)}&error=${error}`,
          request.url,
        ).toString(),
      },
    })
  } catch {
    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL(
          `/verificar-email?email=${encodeURIComponent(email)}&error=server`,
          request.url,
        ).toString(),
      },
    })
  }
}
