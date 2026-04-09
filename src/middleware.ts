import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { getSession } from './lib/db'

export const onRequest = defineMiddleware(async (context, next) => {
  const db = (env as any).DB

  // CSRF: validar Origin en peticiones POST/PUT/DELETE
  if (['POST', 'PUT', 'DELETE'].includes(context.request.method)) {
    const origin = context.request.headers.get('origin')
    const host = context.request.headers.get('host')
    if (origin && host && !origin.includes(host)) {
      return new Response('Forbidden – origen no permitido', { status: 403 })
    }
  }

  if (db) {
    const cookie = context.cookies.get('session')
    if (cookie?.value) {
      const user = await getSession(db, cookie.value)
      if (user) {
        ;(context.locals as any).user = user
      }
    }
    ;(context.locals as any).db = db
  }

  const response = await next()

  // Cabeceras de seguridad profesionales
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  )

  return response
})
