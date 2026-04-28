import type { APIRoute } from 'astro'

export const GET: APIRoute = async ({ request, locals }) => {
  const user = (locals as any).user
  if (!user) return new Response('Unauthorized', { status: 401 })

  const db = (locals as any).db
  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''

  if (q.length < 2) {
    return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } })
  }

  const results = await db
    .prepare(
      `SELECT u.id, u.name, u.email, p.rating, p.location
       FROM users u
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE u.role != 'suspended'
         AND (u.name LIKE ? OR u.email LIKE ?)
       ORDER BY u.name ASC
       LIMIT 10`,
    )
    .bind(`%${q}%`, `%${q}%`)
    .all()

  const players = (results.results ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    rating: r.rating ? Number(r.rating).toFixed(1) : '1.0',
    location: r.location || '',
  }))

  return new Response(JSON.stringify(players), {
    headers: { 'Content-Type': 'application/json' },
  })
}
