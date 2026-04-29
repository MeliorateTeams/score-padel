import type { D1Database } from '@cloudflare/workers-types'
import { generateId } from './auth'

const MIN_RATING = 1.0
const MAX_RATING = 7.0
const MAX_PROVISIONAL_RATING = 6.5
const K_FACTOR = 0.6

interface QuestionnaireAnswers {
  experienceScore: number
  frequencyScore: number
  technicalScore: number
  competitiveScore: number
  tacticalScore: number
  racquetScore: number
  selfEvaluationScore: number
}

interface MatchForRebuild {
  id: string
  tournament_id: string | null
  team1_player1: string
  team1_player2: string | null
  team2_player1: string
  team2_player2: string | null
  team1_games: number
  team2_games: number
  set_scores: string | null
  created_at: string
  confirmation_total: number | null
  confirmed_count: number | null
}

function clampRating(value: number): number {
  const bounded = Math.max(MIN_RATING, Math.min(MAX_RATING, value))
  return Math.round(bounded * 100) / 100
}

function clampProvisionalRating(value: number): number {
  const bounded = Math.max(MIN_RATING, Math.min(MAX_PROVISIONAL_RATING, value))
  return Math.round(bounded * 100) / 100
}

function parseSqliteDate(value: string): Date {
  return new Date(value.replace(' ', 'T') + 'Z')
}

function expectedGamePercentage(ratingA: number, ratingB: number): number {
  const diff = ratingA - ratingB
  return 1 / (1 + Math.pow(10, -diff / 2))
}

function getSetCount(setScores: string | null): number {
  if (!setScores) return 0
  try {
    const parsed = JSON.parse(setScores)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

function getFormatWeight(setCount: number, totalGames: number): number {
  if (setCount >= 3 || totalGames >= 30) return 1.0
  if (setCount >= 2 || totalGames >= 18) return 0.85
  return 0.7
}

function getCompetitivenessWeight(ratingDiff: number): number {
  const diff = Math.abs(ratingDiff)
  if (diff <= 0.5) return 1.0
  if (diff <= 1.0) return 0.8
  if (diff <= 1.5) return 0.6
  return 0.4
}

function getReliabilityWeight(priorMatches: number): number {
  if (priorMatches >= 10) return 1.0
  if (priorMatches >= 5) return 0.85
  if (priorMatches >= 1) return 0.65
  return 0.5
}

function getRecencyWeight(matchAgeInDays: number): number {
  if (matchAgeInDays <= 30) return 1.0
  if (matchAgeInDays <= 90) return 0.85
  if (matchAgeInDays <= 180) return 0.65
  if (matchAgeInDays <= 365) return 0.4
  return 0.0
}

function getEventWeight(
  tournamentId: string | null,
  confirmedCount: number,
  totalConfirmations: number,
  playerCount: number,
): number {
  if (tournamentId) return 1.0
  if (totalConfirmations >= playerCount && confirmedCount >= playerCount) return 0.5
  return 0.0
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function getSportsCount(racquetSports: string): number {
  return racquetSports
    .split(',')
    .map((sport) => sport.trim())
    .filter(Boolean).length
}

function getSelfEvaluationSeed(score: number): number {
  const seeds: Record<number, number> = {
    10: 1.25,
    15: 1.75,
    25: 2.5,
    35: 3.5,
    45: 4.5,
    55: 5.5,
    65: 6.5,
  }
  return seeds[score] ?? 2.5
}

function normalize(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(1, value / max))
}

export function calculateQuestionnaireInitialRating(answers: QuestionnaireAnswers): number {
  const declaredSeed = getSelfEvaluationSeed(answers.selfEvaluationScore)
  const objectiveScore =
    normalize(answers.experienceScore, 15) * 0.18 +
    normalize(answers.frequencyScore, 6) * 0.12 +
    normalize(answers.technicalScore, 10) * 0.24 +
    normalize(answers.competitiveScore, 10) * 0.18 +
    normalize(answers.tacticalScore, 6) * 0.18 +
    normalize(answers.racquetScore, 4) * 0.1

  const objectiveSeed = 1.0 + objectiveScore * 5.5
  const gap = objectiveSeed - declaredSeed

  let provisional = declaredSeed * 0.55 + objectiveSeed * 0.45
  if (Math.abs(gap) > 1.0) {
    const lower = Math.min(declaredSeed, objectiveSeed)
    provisional = lower + Math.abs(gap) * 0.35
  }

  return clampProvisionalRating(provisional)
}

export function calculateInitialRating(experienceYears: number, racquetSports: string): number {
  let seed = 1.5

  if (experienceYears >= 10) seed = 5.5
  else if (experienceYears >= 5) seed = 4.5
  else if (experienceYears >= 3) seed = 3.5
  else if (experienceYears >= 1) seed = 2.5

  const sportsCount = getSportsCount(racquetSports)
  if (sportsCount >= 2) seed += 0.5
  else if (sportsCount >= 1) seed += 0.25

  return clampProvisionalRating(seed)
}

async function getSeedRatings(db: D1Database): Promise<Map<string, number>> {
  const seeds = new Map<string, number>()
  const earliestSeedLoaded = new Set<string>()

  const profiles = await db
    .prepare('SELECT user_id, rating FROM profiles')
    .all<{ user_id: string; rating: number }>()

  for (const row of profiles.results ?? []) {
    seeds.set(row.user_id, clampRating(row.rating ?? MIN_RATING))
  }

  const history = await db
    .prepare('SELECT user_id, old_rating FROM rating_history ORDER BY created_at ASC, id ASC')
    .all<{ user_id: string; old_rating: number }>()

  for (const row of history.results ?? []) {
    if (earliestSeedLoaded.has(row.user_id)) continue
    seeds.set(row.user_id, clampRating(row.old_rating ?? MIN_RATING))
    earliestSeedLoaded.add(row.user_id)
  }

  return seeds
}

async function getMatchesForRebuild(db: D1Database): Promise<MatchForRebuild[]> {
  const rows = await db
    .prepare(
      `
      SELECT
        m.id,
        m.tournament_id,
        m.team1_player1,
        m.team1_player2,
        m.team2_player1,
        m.team2_player2,
        m.team1_games,
        m.team2_games,
        m.set_scores,
        m.created_at,
        COUNT(mc.user_id) AS confirmation_total,
        SUM(CASE WHEN mc.confirmed = 1 THEN 1 ELSE 0 END) AS confirmed_count
      FROM matches m
      LEFT JOIN match_confirmations mc ON mc.match_id = m.id
      WHERE m.status = 'completed'
      GROUP BY m.id
      ORDER BY m.created_at ASC, m.id ASC
    `,
    )
    .all<MatchForRebuild>()

  return (rows.results ?? []) as MatchForRebuild[]
}

export async function rebuildRatingsFromMatches(db: D1Database): Promise<void> {
  const seedRatings = await getSeedRatings(db)
  const matches = await getMatchesForRebuild(db)

  const currentRatings = new Map<string, number>()
  const matchesPlayed = new Map<string, number>()
  const matchesWon = new Map<string, number>()

  for (const [userId, seed] of seedRatings.entries()) {
    currentRatings.set(userId, clampRating(seed))
    matchesPlayed.set(userId, 0)
    matchesWon.set(userId, 0)
  }

  await db.prepare('DELETE FROM rating_history').run()
  await db.prepare('UPDATE profiles SET matches_played = 0, matches_won = 0').run()

  for (const match of matches) {
    const team1Players = [match.team1_player1, match.team1_player2].filter(Boolean) as string[]
    const team2Players = [match.team2_player1, match.team2_player2].filter(Boolean) as string[]
    const allPlayers = [...team1Players, ...team2Players]

    if (allPlayers.length === 0) continue

    for (const playerId of allPlayers) {
      if (!currentRatings.has(playerId)) {
        currentRatings.set(playerId, MIN_RATING)
        matchesPlayed.set(playerId, 0)
        matchesWon.set(playerId, 0)
      }
    }

    const totalGames = Number(match.team1_games ?? 0) + Number(match.team2_games ?? 0)
    const setCount = getSetCount(match.set_scores)
    const playerCount = allPlayers.length
    const confirmedCount = Number(match.confirmed_count ?? 0)
    const confirmationTotal = Number(match.confirmation_total ?? 0)
    const eventWeight = getEventWeight(
      match.tournament_id,
      confirmedCount,
      confirmationTotal,
      playerCount,
    )

    if (eventWeight > 0) {
      const team1Won = Number(match.team1_games ?? 0) > Number(match.team2_games ?? 0)
      for (const playerId of allPlayers) {
        matchesPlayed.set(playerId, (matchesPlayed.get(playerId) ?? 0) + 1)
      }
      for (const playerId of team1Won ? team1Players : team2Players) {
        matchesWon.set(playerId, (matchesWon.get(playerId) ?? 0) + 1)
      }
    }

    if (totalGames <= 0 || eventWeight <= 0) continue

    const ageInDays = Math.max(
      0,
      (Date.now() - parseSqliteDate(match.created_at).getTime()) / (1000 * 60 * 60 * 24),
    )
    const recencyWeight = getRecencyWeight(ageInDays)
    if (recencyWeight <= 0) continue

    const team1Rating = average(
      team1Players.map((playerId) => currentRatings.get(playerId) ?? MIN_RATING),
    )
    const team2Rating = average(
      team2Players.map((playerId) => currentRatings.get(playerId) ?? MIN_RATING),
    )
    const expectedTeam1 = expectedGamePercentage(team1Rating, team2Rating)
    const actualTeam1 = Number(match.team1_games ?? 0) / totalGames
    const competitivenessWeight = getCompetitivenessWeight(team1Rating - team2Rating)
    const priorMatchAverage = Math.max(
      0,
      Math.round(average(allPlayers.map((playerId) => matchesPlayed.get(playerId) ?? 0)) - 1),
    )
    const reliabilityWeight = getReliabilityWeight(priorMatchAverage)
    const formatWeight = getFormatWeight(setCount, totalGames)
    const totalWeight =
      formatWeight * competitivenessWeight * reliabilityWeight * recencyWeight * eventWeight
    const delta = K_FACTOR * totalWeight * (actualTeam1 - expectedTeam1)

    if (Math.abs(delta) < 0.0001) continue

    const team1Changes = team1Players.map((playerId) => {
      const oldRating = currentRatings.get(playerId) ?? MIN_RATING
      const newRating = clampRating(oldRating + delta)
      return { playerId, oldRating, newRating }
    })

    const team2Changes = team2Players.map((playerId) => {
      const oldRating = currentRatings.get(playerId) ?? MIN_RATING
      const newRating = clampRating(oldRating - delta)
      return { playerId, oldRating, newRating }
    })

    for (const change of [...team1Changes, ...team2Changes]) {
      currentRatings.set(change.playerId, change.newRating)
      await db
        .prepare(
          'INSERT INTO rating_history (id, user_id, old_rating, new_rating, match_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(
          generateId(),
          change.playerId,
          change.oldRating,
          change.newRating,
          match.id,
          match.created_at,
        )
        .run()
    }
  }

  for (const [userId, rating] of currentRatings.entries()) {
    await db
      .prepare(
        "UPDATE profiles SET rating = ?, matches_played = ?, matches_won = ?, updated_at = datetime('now') WHERE user_id = ?",
      )
      .bind(
        clampRating(rating),
        matchesPlayed.get(userId) ?? 0,
        matchesWon.get(userId) ?? 0,
        userId,
      )
      .run()
  }
}

export async function recalculatePlayerRating(db: D1Database, playerId: string): Promise<number> {
  await rebuildRatingsFromMatches(db)
  const profile = await db
    .prepare('SELECT rating FROM profiles WHERE user_id = ?')
    .bind(playerId)
    .first<{ rating: number }>()
  return clampRating(profile?.rating ?? MIN_RATING)
}

export async function calculateAndUpdateRatings(
  db: D1Database,
  _matchId: string,
  _team1Players: string[],
  _team2Players: string[],
  _team1Games: number,
  _team2Games: number,
) {
  await rebuildRatingsFromMatches(db)
}
