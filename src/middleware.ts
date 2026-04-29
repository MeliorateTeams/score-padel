import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { getSession } from './lib/db'

// Rate limiting: in-memory per Worker instance
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW = 60_000 // 1 minute
const RATE_LIMIT_MAX_AUTH = 10 // max 10 login/register attempts per minute per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX_AUTH
}

// Cleanup stale entries periodically (every 100 checks)
let cleanupCounter = 0
function cleanupRateLimits() {
  if (++cleanupCounter % 100 !== 0) return
  const now = Date.now()
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key)
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const db = (env as any).DB
  const url = new URL(context.request.url)

  // Rate limiting on auth endpoints
  if (
    context.request.method === 'POST' &&
    [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/verify-email',
      '/api/auth/resend-verification',
    ].includes(url.pathname)
  ) {
    const ip =
      context.request.headers.get('cf-connecting-ip') ||
      context.request.headers.get('x-forwarded-for') ||
      'unknown'
    cleanupRateLimits()
    if (isRateLimited(ip)) {
      return new Response('Demasiados intentos. Espera un minuto.', {
        status: 429,
        headers: { 'Retry-After': '60' },
      })
    }
  }

  // CSRF: validar Origin en peticiones POST/PUT/DELETE (strict URL comparison)
  if (['POST', 'PUT', 'DELETE'].includes(context.request.method)) {
    const origin = context.request.headers.get('origin')
    const host = context.request.headers.get('host')
    if (!origin || !host) {
      return new Response('Forbidden – falta cabecera Origin', { status: 403 })
    }
    try {
      const originHost = new URL(origin).host
      if (originHost !== host) {
        return new Response('Forbidden – origen no permitido', { status: 403 })
      }
    } catch {
      return new Response('Forbidden – origen inválido', { status: 403 })
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

    const currentUser = (context.locals as any).user
    if (
      currentUser &&
      currentUser.role !== 'admin' &&
      ['GET', 'HEAD'].includes(context.request.method) &&
      url.pathname.startsWith('/app') &&
      url.pathname !== '/app/cuestionario'
    ) {
      const profile = await db
        .prepare('SELECT rating, matches_played FROM profiles WHERE user_id = ?')
        .bind(currentUser.id)
        .first<{ rating: number; matches_played: number }>()

      const needsInitialPlacement =
        !profile || ((profile.matches_played ?? 0) === 0 && Number(profile.rating ?? 1) <= 1.0)

      if (needsInitialPlacement) {
        return Response.redirect(new URL('/app/cuestionario', context.request.url), 302)
      }
    }
  }

  const response = await next()

  // Prevent browsers from caching SSR pages (dynamic HTML must always be fresh)
  const ct = response.headers.get('Content-Type') || ''
  if (ct.includes('text/html')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  }

  // Cabeceras de seguridad profesionales
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-DNS-Prefetch-Control', 'off')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()',
  )
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://unpkg.com",
      "font-src 'self'",
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
      "connect-src 'self' https://challenges.cloudflare.com https://overpass-api.de https://nominatim.openstreetmap.org",
      'frame-src https://challenges.cloudflare.com',
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  )
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin')

  return response
})
