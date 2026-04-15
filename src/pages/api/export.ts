import type { APIRoute } from 'astro'

// Sanitize cell values to prevent CSV injection (formula injection attack)
function csvCell(value: string | null | undefined): string {
  const str = (value ?? '').toString()
  // Prefix cells starting with formula triggers with a tab character
  if (/^[=+\-@\t\r]/.test(str)) return `\t${str}`
  return str
}

export const GET: APIRoute = async ({ locals, url }) => {
  const user = (locals as any).user
  if (!user) return new Response('Unauthorized', { status: 401 })

  const db = (locals as any).db
  const type = url.searchParams.get('type') || 'clasificacion'

  let csv = ''
  let filename = 'export.csv'

  if (type === 'clasificacion') {
    filename = 'clasificacion.csv'
    csv = 'Nombre,Rating,Partidos,Victorias,Win Rate,División,Ubicación\n'
    const rows = await db
      .prepare(
        `
      SELECT u.name, p.rating, p.matches_played, p.matches_won, p.location
      FROM users u LEFT JOIN profiles p ON u.id = p.user_id
      WHERE u.role != 'guest'
      ORDER BY p.rating DESC
    `,
      )
      .all()
    for (const r of (rows.results ?? []) as any[]) {
      const wr =
        (r.matches_played ?? 0) > 0
          ? Math.round(((r.matches_won ?? 0) / (r.matches_played ?? 1)) * 100)
          : 0
      const div = (r.rating ?? 1) < 3.5 ? 'C' : (r.rating ?? 1) < 6.0 ? 'B' : 'A'
      csv += `"${csvCell(r.name)}",${Number(r.rating || 1).toFixed(1)},${r.matches_played ?? 0},${r.matches_won ?? 0},${wr}%,${div},"${csvCell(r.location)}"\n`
    }
  } else if (type === 'partidos') {
    filename = 'mis_partidos.csv'
    csv = 'Fecha,Equipo 1,Equipo 2,Games Eq1,Games Eq2,Sets,Resultado\n'
    const rows = await db
      .prepare(
        `
      SELECT m.created_at, m.team1_games, m.team2_games, m.set_scores,
        u1.name as t1p1, u2.name as t1p2, u3.name as t2p1, u4.name as t2p2
      FROM matches m
      LEFT JOIN users u1 ON m.team1_player1 = u1.id
      LEFT JOIN users u2 ON m.team1_player2 = u2.id
      LEFT JOIN users u3 ON m.team2_player1 = u3.id
      LEFT JOIN users u4 ON m.team2_player2 = u4.id
      WHERE m.team1_player1 = ? OR m.team1_player2 = ? OR m.team2_player1 = ? OR m.team2_player2 = ?
      ORDER BY m.created_at DESC
    `,
      )
      .bind(user.id, user.id, user.id, user.id)
      .all()
    for (const m of (rows.results ?? []) as any[]) {
      const date = new Date(m.created_at).toLocaleDateString('es-ES')
      const t1 = [m.t1p1, m.t1p2].filter(Boolean).join(' & ')
      const t2 = [m.t2p1, m.t2p2].filter(Boolean).join(' & ')
      const isT1 = m.t1p1 === user.name || m.t1p2 === user.name
      const result =
        m.team1_games === m.team2_games
          ? 'Empate'
          : (isT1 ? m.team1_games > m.team2_games : m.team2_games > m.team1_games)
            ? 'Victoria'
            : 'Derrota'
      csv += `${date},"${csvCell(t1)}","${csvCell(t2)}",${m.team1_games},${m.team2_games},"${csvCell(m.set_scores)}",${result}\n`
    }
  } else if (type === 'torneo') {
    const tid = url.searchParams.get('tid')
    if (!tid) return new Response('Missing tournament id', { status: 400 })
    // Only admin or tournament participant/creator can export
    const t = (await db
      .prepare('SELECT name, creator_id FROM tournaments WHERE id = ?')
      .bind(tid)
      .first()) as any
    if (!t) return new Response('Tournament not found', { status: 404 })
    const isParticipant = await db
      .prepare('SELECT 1 FROM tournament_players WHERE tournament_id = ? AND user_id = ?')
      .bind(tid, user.id)
      .first()
    if (user.role !== 'admin' && t.creator_id !== user.id && !isParticipant) {
      return new Response('Forbidden', { status: 403 })
    }
    filename = `torneo_${(t as any)?.name || 'export'}.csv`.replace(/[^a-zA-Z0-9._-]/g, '_')
    csv = 'Fecha,Equipo 1,Equipo 2,Games Eq1,Games Eq2,Estado\n'
    const rows = await db
      .prepare(
        `
      SELECT m.created_at, m.team1_games, m.team2_games, m.status,
        u1.name as t1, u2.name as t2
      FROM matches m
      JOIN users u1 ON m.team1_player1 = u1.id
      JOIN users u2 ON m.team2_player1 = u2.id
      WHERE m.tournament_id = ?
      ORDER BY m.created_at DESC
    `,
      )
      .bind(tid)
      .all()
    for (const m of (rows.results ?? []) as any[]) {
      const date = new Date(m.created_at).toLocaleDateString('es-ES')
      csv += `${date},"${csvCell(m.t1)}","${csvCell(m.t2)}",${m.team1_games},${m.team2_games},${m.status || 'completed'}\n`
    }
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
