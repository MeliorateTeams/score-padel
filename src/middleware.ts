import { defineMiddleware } from 'astro:middleware'
import { getSession } from './lib/db'

export const onRequest = defineMiddleware(async (context, next) => {
  const runtime = (context.locals as any).runtime
  const db = runtime?.env?.DB

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
