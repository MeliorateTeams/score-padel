import type { D1Database } from '@cloudflare/workers-types'
import { generateId } from './auth'

// Rating algorithm based on the 3 factors from the Score Padel document:
// 1. Difference between player ratings
// 2. Percentage of games won vs expected
// 3. Recent results compared to best recent performance

const K_FACTOR = 0.5 // How much a single match can change rating
const MIN_RATING = 1.0
const MAX_RATING = 7.0

function expectedScore(ratingA: number, ratingB: number): number {
  // Expected win probability based on rating difference
  const diff = ratingB - ratingA
  return 1 / (1 + Math.pow(10, diff / 2))
}

function clampRating(r: number): number {
  return Math.round(Math.max(MIN_RATING, Math.min(MAX_RATING, r)) * 10) / 10
}

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

  // Get current ratings
  const allPlayers = [...team1Players, ...team2Players]
  const ratings: Record<string, number> = {}

  for (const pid of allPlayers) {
    const p = await db
      .prepare('SELECT rating FROM profiles WHERE user_id = ?')
      .bind(pid)
      .first<{ rating: number }>()
    ratings[pid] = p?.rating ?? 1.0
  }

  // Average team ratings
  const team1Avg = team1Players.reduce((s, p) => s + ratings[p], 0) / team1Players.length
  const team2Avg = team2Players.reduce((s, p) => s + ratings[p], 0) / team2Players.length

  // Factor 1: Rating difference (expected score)
  const expected1 = expectedScore(team1Avg, team2Avg)
  const expected2 = 1 - expected1

  // Factor 2: Actual performance vs expected
  const actual1 = team1Games / totalGames
  const actual2 = team2Games / totalGames

  // Factor 3: Simplified - larger upsets = bigger changes
  const surprise1 = actual1 - expected1
  const surprise2 = actual2 - expected2

  // Determine winner (for matches_won)
  const team1Won = team1Games > team2Games

  // Update each player
  for (const pid of team1Players) {
    const oldRating = ratings[pid]
    const newRating = clampRating(oldRating + K_FACTOR * surprise1)
    await db
      .prepare(
        'UPDATE profiles SET rating = ?, matches_played = matches_played + 1, matches_won = matches_won + ? WHERE user_id = ?',
      )
      .bind(newRating, team1Won ? 1 : 0, pid)
      .run()
    await db
      .prepare(
        'INSERT INTO rating_history (id, user_id, old_rating, new_rating, match_id) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(generateId(), pid, oldRating, newRating, matchId)
      .run()
  }

  for (const pid of team2Players) {
    const oldRating = ratings[pid]
    const newRating = clampRating(oldRating + K_FACTOR * surprise2)
    await db
      .prepare(
        'UPDATE profiles SET rating = ?, matches_played = matches_played + 1, matches_won = matches_won + ? WHERE user_id = ?',
      )
      .bind(newRating, team1Won ? 0 : 1, pid)
      .run()
    await db
      .prepare(
        'INSERT INTO rating_history (id, user_id, old_rating, new_rating, match_id) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(generateId(), pid, oldRating, newRating, matchId)
      .run()
  }
}
