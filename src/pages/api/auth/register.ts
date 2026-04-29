import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import {
  createEmailVerificationChallenge,
  createSession,
  createUser,
  getUserEmailVerificationState,
} from '../../../lib/db'
import { isAllowedEmailDomain } from '../../../lib/auth'
import { sendVerificationCodeEmail } from '../../../lib/email'
import { isEmailVerificationEnabled } from '../../../lib/features'

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = (env as any).TURNSTILE_SECRET
  if (!secret) return false // fail-closed: sin secret, denegar
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
  })
  const data = (await res.json()) as { success: boolean }
  return data.success === true
}

export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).db
  if (!db) return new Response('Server error', { status: 500 })
  const emailVerificationEnabled = isEmailVerificationEnabled(env as Record<string, unknown>)

  const form = await request.formData()
  const name = form.get('name')?.toString().trim()
  const email = form.get('email')?.toString().trim().toLowerCase()
  const password = form.get('password')?.toString()
  const age = form.get('age')
  const privacy = form.get('privacy')
  const turnstileToken = form.get('cf-turnstile-response')?.toString() ?? ''

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || ''
  const humanOk = await verifyTurnstile(turnstileToken, ip)
  if (!humanOk) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/registro?error=captcha', request.url).toString() },
    })
  }

  if (!name || !email || !password) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/registro?error=campos', request.url).toString() },
    })
  }

  // Sanitize name: strip HTML tags
  const safeName = name.replace(/<[^>]*>/g, '').trim()

  // Enforce input length limits to prevent DoS / oversized payloads
  if (name.length > 100 || email.length > 254 || password.length > 128) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/registro?error=campos', request.url).toString() },
    })
  }

  if (!isAllowedEmailDomain(email)) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/registro?error=email', request.url).toString() },
    })
  }

  if (!age) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/registro?error=edad', request.url).toString() },
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

  // Password complexity: at least 1 uppercase, 1 lowercase, 1 digit
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/registro?error=password_weak', request.url).toString() },
    })
  }

  try {
    if (!emailVerificationEnabled) {
      const userId = await createUser(db, email, password, safeName)
      const token = await createSession(db, userId)

      return new Response(null, {
        status: 303,
        headers: {
          'Set-Cookie': `session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${72 * 3600}`,
          Location: new URL('/app/cuestionario', request.url).toString(),
        },
      })
    }

    const userId = await createUser(db, email, password, safeName, { emailVerified: false })
    const verification = await createEmailVerificationChallenge(db, userId)

    await sendVerificationCodeEmail({
      binding: (env as any).EMAIL,
      fromAddress: (env as any).EMAIL_FROM,
      to: email,
      code: verification.code,
      verificationUrl: new URL(
        `/verificar-email?email=${encodeURIComponent(email)}`,
        request.url,
      ).toString(),
    })

    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL(
          `/verificar-email?email=${encodeURIComponent(email)}&sent=1`,
          request.url,
        ).toString(),
      },
    })
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      const existingUser = await getUserEmailVerificationState(db, email)
      if (emailVerificationEnabled && existingUser && !existingUser.verifiedAt) {
        return new Response(null, {
          status: 303,
          headers: {
            Location: new URL(
              `/verificar-email?email=${encodeURIComponent(email)}&error=unverified`,
              request.url,
            ).toString(),
          },
        })
      }

      return new Response(null, {
        status: 303,
        headers: { Location: new URL('/registro?error=existe', request.url).toString() },
      })
    }

    if (email && (e.message === 'EMAIL_CONFIG_MISSING' || e.code)) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: new URL(
            `/verificar-email?email=${encodeURIComponent(email)}&error=email_send`,
            request.url,
          ).toString(),
        },
      })
    }

    return new Response(null, {
      status: 303,
      headers: { Location: new URL('/registro?error=server', request.url).toString() },
    })
  }
}
