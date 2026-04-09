import type { APIRoute } from 'astro'
import { deleteSession } from '../../../lib/db'

export const POST: APIRoute = async ({ cookies, locals }) => {
  const db = (locals as any).db
  const token = cookies.get('session')?.value
  if (db && token) {
    await deleteSession(db, token)
  }
  cookies.delete('session', { path: '/' })
  return Response.redirect(new URL('/login', 'https://scorepadel.padelzone.workers.dev'), 303)
}
