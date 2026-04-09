import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { getSession } from './lib/db'

export const onRequest = defineMiddleware(async (context, next) => {
  const db = (env as any).DB

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

  return next()
})
