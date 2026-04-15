import type { APIRoute } from 'astro'

export const POST: APIRoute = async ({ request, locals }) => {
  const user = (locals as any).user
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const db = (locals as any).db
  if (!db) {
    return new Response(JSON.stringify({ error: 'DB no disponible' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const formData = await request.formData()
  const action = formData.get('action')?.toString()

  if (action === 'add') {
    const image_url = formData.get('image_url')?.toString()?.trim()
    const alt_text = formData.get('alt_text')?.toString()?.trim() || ''
    const sort_order = parseInt(formData.get('sort_order')?.toString() || '0', 10)

    if (!image_url) {
      return new Response(JSON.stringify({ error: 'URL de imagen requerida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Basic URL validation
    try {
      new URL(image_url)
    } catch {
      return new Response(JSON.stringify({ error: 'URL no válida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    await db
      .prepare('INSERT INTO carousel_images (image_url, alt_text, sort_order) VALUES (?, ?, ?)')
      .bind(image_url, alt_text, sort_order)
      .run()

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (action === 'delete') {
    const id = formData.get('id')?.toString()
    if (!id) {
      return new Response(JSON.stringify({ error: 'ID requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    await db.prepare('DELETE FROM carousel_images WHERE id = ?').bind(id).run()
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (action === 'toggle') {
    const id = formData.get('id')?.toString()
    if (!id) {
      return new Response(JSON.stringify({ error: 'ID requerido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    await db
      .prepare(
        'UPDATE carousel_images SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?',
      )
      .bind(id)
      .run()
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (action === 'reorder') {
    const ids = formData.get('ids')?.toString()
    if (!ids) {
      return new Response(JSON.stringify({ error: 'IDs requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const idArray = ids.split(',')
    for (let i = 0; i < idArray.length; i++) {
      await db
        .prepare('UPDATE carousel_images SET sort_order = ? WHERE id = ?')
        .bind(i, idArray[i])
        .run()
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ error: 'Acción no válida' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}
