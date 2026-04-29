import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import {
  createEmailVerificationChallenge,
  getUserEmailVerificationState,
  getVerificationResendRetrySeconds,
} from '../../../lib/db'
import { sendVerificationCodeEmail } from '../../../lib/email'

export const POST: APIRoute = async ({ request, locals }) => {
  const db = (locals as any).db
  if (!db) return new Response('Server error', { status: 500 })

  const form = await request.formData()
  const email = form.get('email')?.toString().trim().toLowerCase() ?? ''

  if (!email) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL('/verificar-email?error=missing_email', request.url).toString(),
      },
    })
  }

  try {
    const state = await getUserEmailVerificationState(db, email)
    if (!state) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: new URL(
            `/verificar-email?email=${encodeURIComponent(email)}&resent=1`,
            request.url,
          ).toString(),
        },
      })
    }

    if (state.verifiedAt) {
      return new Response(null, {
        status: 303,
        headers: { Location: new URL('/login?verified=1', request.url).toString() },
      })
    }

    const retrySeconds = await getVerificationResendRetrySeconds(db, state.userId)
    if (retrySeconds > 0) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: new URL(
            `/verificar-email?email=${encodeURIComponent(email)}&error=throttled`,
            request.url,
          ).toString(),
        },
      })
    }

    const verification = await createEmailVerificationChallenge(db, state.userId)
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
          `/verificar-email?email=${encodeURIComponent(email)}&resent=1`,
          request.url,
        ).toString(),
      },
    })
  } catch {
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
}
