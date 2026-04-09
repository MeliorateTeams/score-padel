import type { D1Database } from '@cloudflare/workers-types'
import { generateId } from './auth'

// Score Padel Rating Algorithm
// Escala: 1.0 - 7.0 (valoración, no ranking)
// Basado en el documento Score Padel:
// 1. Diferencia entre clasificaciones de los jugadores enfrentados
// 2. % de juegos ganados vs resultado esperado
// 3. Resultados recientes (promedio ponderado de hasta 30 partidos, últimos 12 meses)
//
// Para cada partido se calcula:
//   - Valoración de partido (match rating): qué rating implica la actuación
//   - Peso del partido (match weight): competitividad, fiabilidad rival, degradación temporal
//
// La valoración Score Padel = promedio ponderado de las valoraciones de partido

const MIN_RATING = 1.0
const MAX_RATING = 7.0
const MAX_MATCHES_FOR_AVERAGE = 30
const MONTHS_WINDOW = 12

function clampRating(r: number): number {
  return Math.round(Math.max(MIN_RATING, Math.min(MAX_RATING, r)) * 10) / 10
}

/**
 * Calcula el % de juegos esperado para el equipo A dada la diferencia de ratings.
 * Escala 1-7 de pádel (no 1-16.5 de tenis).
 */
function expectedGamePercentage(ratingA: number, ratingB: number): number {
  const diff = ratingA - ratingB
  // Sigmoid centrado: si diff=0 → 50%, si diff=+3 → ~95%, si diff=-3 → ~5%
  return 1 / (1 + Math.pow(10, -diff / 1.5))
}

/**
 * Calcula la valoración de partido para un jugador/equipo.
 * Si rindió mejor de lo esperado, su match rating será más alto que su rating actual.
 */
function calculateMatchRating(
  playerRating: number,
  opponentRating: number,
  gamesWon: number,
  totalGames: number,
): number {
  if (totalGames === 0) return playerRating

  const expectedPct = expectedGamePercentage(playerRating, opponentRating)
  const actualPct = gamesWon / totalGames

  // Diferencia entre rendimiento real y esperado
  const performanceDelta = actualPct - expectedPct

  // Convertir la diferencia en ajuste de rating
  // Factor de escala: rendimiento perfecto (delta ~0.5) → aprox ±1.5 puntos de rating
  const ratingAdjustment = performanceDelta * 3.0

  // La valoración de partido = rating del oponente ajustado por rendimiento
  // Si ganas más de lo esperado contra alguien de 4.0, tu match rating > 4.0
  const matchRating = opponentRating + ratingAdjustment

  return clampRating(matchRating)
}

/**
 * Calcula el peso del partido según (punto 8c del documento):
 * - Formato: partidos más largos → más peso (más fiable el resultado)
 * - Competitividad: ratings más cercanos → más peso
 * - Fiabilidad: oponente con más partidos → más peso
 * - Degradación temporal: partidos más recientes → más peso
 */
function calculateMatchWeight(
  ratingDiff: number,
  opponentMatchesPlayed: number,
  matchAgeInDays: number,
  totalGames: number,
): number {
  // Formato/duración: partidos con más juegos son más representativos
  // 6 juegos (mínimo) → 0.5, 12 juegos → ~0.8, 24+ juegos → ~1.0
  const formatWeight = 0.5 + 0.5 * Math.min(totalGames / 24, 1)

  // Competitividad: partidos entre rivales cercanos pesan más
  // diff=0 → peso 1.0, diff=3 → peso ~0.25
  const competitiveness = 1 / (1 + Math.pow(Math.abs(ratingDiff) / 1.5, 2))

  // Fiabilidad del rival: más partidos jugados = rating más fiable
  // 0 partidos → 0.3, 5+ partidos → ~1.0
  const reliability = 0.3 + 0.7 * Math.min(opponentMatchesPlayed / 5, 1)

  // Degradación temporal: partidos recientes pesan más
  // 0 días → 1.0, 180 días → ~0.5, 365 días → ~0.25
  const timeDecay = Math.pow(0.5, matchAgeInDays / 180)

  return formatWeight * competitiveness * reliability * timeDecay
}

/**
 * Recalcula la valoración Score Padel de un jugador.
 * Promedio ponderado de hasta 30 valoraciones de partido más recientes (últimos 12 meses).
 * Incorpora factor 8b.iii: mejor resultado reciente influye en la valoración final.
 */
export async function recalculatePlayerRating(db: D1Database, playerId: string): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - MONTHS_WINDOW)

  // Obtener historial reciente con datos del partido
  const history = await db
    .prepare(
      `
    SELECT rh.old_rating, rh.new_rating, rh.match_id, rh.created_at,
           m.team1_player1, m.team2_player1, m.team1_games, m.team2_games
    FROM rating_history rh
    JOIN matches m ON rh.match_id = m.id
    WHERE rh.user_id = ? AND rh.created_at > ?
    ORDER BY rh.created_at DESC
    LIMIT ?
    `,
    )
    .bind(playerId, cutoffDate.toISOString(), MAX_MATCHES_FOR_AVERAGE)
    .all()

  if (!history.results || history.results.length === 0) {
    // Sin partidos recientes: usar rating de perfil o calcular desde perfil
    const profile = await db
      .prepare('SELECT rating, experience_years, racquet_sports FROM profiles WHERE user_id = ?')
      .bind(playerId)
      .first<{ rating: number; experience_years: number; racquet_sports: string }>()
    if (!profile) return MIN_RATING
    // Si no tiene partidos, mantener rating actual (puede ser el inicial por perfil)
    return profile.rating
  }

  let weightedSum = 0
  let totalWeight = 0
  let bestMatchRating = MIN_RATING

  for (const h of history.results as any[]) {
    const isTeam1 = h.team1_player1 === playerId
    const gamesWon = isTeam1 ? h.team1_games : h.team2_games
    const totalGames = h.team1_games + h.team2_games
    const opponentId = isTeam1 ? h.team2_player1 : h.team1_player1

    // Obtener datos del oponente
    const opponent = await db
      .prepare('SELECT rating, matches_played FROM profiles WHERE user_id = ?')
      .bind(opponentId)
      .first<{ rating: number; matches_played: number }>()

    const opponentRating = opponent?.rating ?? MIN_RATING
    const opponentMatches = opponent?.matches_played ?? 0
    const playerRatingAtTime = h.old_rating as number

    // Valoración de partido
    const matchRating = calculateMatchRating(
      playerRatingAtTime,
      opponentRating,
      gamesWon,
      totalGames,
    )

    // Rastrear mejor resultado reciente (punto 8b.iii)
    if (matchRating > bestMatchRating) bestMatchRating = matchRating

    // Antiguedad del partido en días
    const matchDate = new Date(h.created_at as string)
    const ageInDays = Math.max(0, (Date.now() - matchDate.getTime()) / (1000 * 60 * 60 * 24))

    // Peso del partido (incluye formato/duración - punto 8c)
    const ratingDiff = playerRatingAtTime - opponentRating
    const weight = calculateMatchWeight(ratingDiff, opponentMatches, ageInDays, totalGames)

    weightedSum += matchRating * weight
    totalWeight += weight
  }

  if (totalWeight === 0) return MIN_RATING

  const weightedAvg = weightedSum / totalWeight

  // Punto 8b.iii: resultados recientes comparados con mejor resultado reciente
  // Mezcla promedio ponderado (80%) con mejor resultado reciente (20%)
  // Esto reconoce el potencial demostrado del jugador, no solo su promedio
  const peakBlend = 0.8 * weightedAvg + 0.2 * bestMatchRating

  return clampRating(peakBlend)
}

/**
 * Calcula el rating inicial basado en el perfil del jugador.
 * Considera: años de experiencia en pádel y otros deportes de raqueta.
 */
export function calculateInitialRating(experienceYears: number, racquetSports: string): number {
  let base = 1.0

  // Años de experiencia en pádel: hasta +1.5 puntos
  if (experienceYears >= 10) base += 1.5
  else if (experienceYears >= 5) base += 1.0
  else if (experienceYears >= 3) base += 0.7
  else if (experienceYears >= 1) base += 0.3

  // Otros deportes de raqueta: hasta +0.5 puntos
  if (racquetSports && racquetSports.trim().length > 0) {
    const sports = racquetSports
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    base += Math.min(sports.length * 0.2, 0.5)
  }

  return clampRating(base)
}

/**
 * Procesa un nuevo partido:
 * 1. Registra la valoración de partido en el historial
 * 2. Recalcula la valoración Score Padel de cada jugador (promedio ponderado)
 */
export async function calculateAndUpdateRatings(
  db: D1Database,
  matchId: string,
  team1Players: string[],
  team2Players: string[],
  team1Games: number,
  team2Games: number,
) {
  const totalGames = team1Games + team2Games
  if (totalGames === 0) return

  const allPlayers = [...team1Players, ...team2Players]
  const ratings: Record<string, number> = {}

  for (const pid of allPlayers) {
    const p = await db
      .prepare('SELECT rating FROM profiles WHERE user_id = ?')
      .bind(pid)
      .first<{ rating: number }>()
    ratings[pid] = p?.rating ?? 1.0
  }

  const team1Avg = team1Players.reduce((s, p) => s + ratings[p], 0) / team1Players.length
  const team2Avg = team2Players.reduce((s, p) => s + ratings[p], 0) / team2Players.length
  const team1Won = team1Games > team2Games

  // Calcular y guardar valoración de partido para cada jugador del equipo 1
  for (const pid of team1Players) {
    const oldRating = ratings[pid]
    const matchRating = calculateMatchRating(oldRating, team2Avg, team1Games, totalGames)

    // Guardar en historial (new_rating = valoración de este partido)
    await db
      .prepare(
        'INSERT INTO rating_history (id, user_id, old_rating, new_rating, match_id) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(generateId(), pid, oldRating, matchRating, matchId)
      .run()

    // Actualizar contador de partidos
    await db
      .prepare(
        'UPDATE profiles SET matches_played = matches_played + 1, matches_won = matches_won + ? WHERE user_id = ?',
      )
      .bind(team1Won ? 1 : 0, pid)
      .run()

    // Recalcular valoración Score Padel (promedio ponderado)
    const newRating = await recalculatePlayerRating(db, pid)
    await db
      .prepare("UPDATE profiles SET rating = ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(newRating, pid)
      .run()
  }

  // Igual para equipo 2
  for (const pid of team2Players) {
    const oldRating = ratings[pid]
    const matchRating = calculateMatchRating(oldRating, team1Avg, team2Games, totalGames)

    await db
      .prepare(
        'INSERT INTO rating_history (id, user_id, old_rating, new_rating, match_id) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(generateId(), pid, oldRating, matchRating, matchId)
      .run()

    await db
      .prepare(
        'UPDATE profiles SET matches_played = matches_played + 1, matches_won = matches_won + ? WHERE user_id = ?',
      )
      .bind(team1Won ? 0 : 1, pid)
      .run()

    const newRating = await recalculatePlayerRating(db, pid)
    await db
      .prepare("UPDATE profiles SET rating = ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(newRating, pid)
      .run()
  }
}
