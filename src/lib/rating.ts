import type { D1Database } from '@cloudflare/workers-types'
import { generateId } from './auth'

const MIN_RATING = 1.0
const MAX_RATING = 7.0
const MAX_PROVISIONAL_RATING = 6.5
const PROFILE_ONLY_INITIAL_RATING_CAP = 2.5
const EXPECTED_SCORE_SCALE = 1.5
const PERFORMANCE_DELTA_MULTIPLIER = 3.0
const FORMAT_CAP_GAMES = 24
const COMPETITIVENESS_HALF_POINT = 1.5
const RELIABILITY_FULL_MATCHES = 5
const RECENCY_HALF_LIFE_DAYS = 180
const MAX_MATCH_AGE_DAYS = 365
const RECENT_MATCH_WINDOW = 30
const PEAK_AVERAGE_WEIGHT = 0.8
const PEAK_BEST_WEIGHT = 0.2

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
  competition_type: string | null
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

interface PlayerMatchSample {
  createdAt: string
  matchRating: number
  baseWeight: number
}

function clampRating(value: number): number {
  const bounded = Math.max(MIN_RATING, Math.min(MAX_RATING, value))
  return Math.round(bounded * 10) / 10
}

function clampProvisionalRating(value: number): number {
  const bounded = Math.max(MIN_RATING, Math.min(MAX_PROVISIONAL_RATING, value))
  return Math.round(bounded * 10) / 10
}

function parseSqliteDate(value: string): Date {
  return new Date(value.replace(' ', 'T') + 'Z')
}

function expectedGamePercentage(ratingA: number, ratingB: number): number {
  const diff = ratingA - ratingB
  return 1 / (1 + Math.pow(10, -diff / EXPECTED_SCORE_SCALE))
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
  void setCount
  return 0.5 + 0.5 * Math.min(totalGames / FORMAT_CAP_GAMES, 1)
}

function getCompetitivenessWeight(ratingDiff: number): number {
  return 1 / (1 + Math.pow(Math.abs(ratingDiff) / COMPETITIVENESS_HALF_POINT, 2))
}

function getReliabilityWeight(opponentMatches: number): number {
  return 0.3 + 0.7 * Math.min(opponentMatches / RELIABILITY_FULL_MATCHES, 1)
}

function getRecencyWeight(matchAgeInDays: number): number {
  if (matchAgeInDays > MAX_MATCH_AGE_DAYS) return 0.0
  return Math.pow(0.5, matchAgeInDays / RECENCY_HALF_LIFE_DAYS)
}

function isValidatedLeague(competitionType: string | null): boolean {
  return competitionType === 'validated_league'
}

function isOfficialTournament(competitionType: string | null): boolean {
  return !competitionType || competitionType === 'tournament'
}

function getEventWeight(
  competitionType: string | null,
  confirmedCount: number,
  totalConfirmations: number,
  playerCount: number,
): number {
  if (isOfficialTournament(competitionType)) return 1.0
  if (isValidatedLeague(competitionType)) return 0.75
  if (totalConfirmations >= playerCount && confirmedCount >= playerCount) return 0.5
  return 0.0
}

function calculateMatchRating(
  playerTeamRating: number,
  opponentTeamRating: number,
  gamesWon: number,
  totalGames: number,
): number {
  if (totalGames <= 0) return clampRating(playerTeamRating)

  const expectedPct = expectedGamePercentage(playerTeamRating, opponentTeamRating)
  const actualPct = gamesWon / totalGames
  const performanceDelta = actualPct - expectedPct
  return clampRating(opponentTeamRating + performanceDelta * PERFORMANCE_DELTA_MULTIPLIER)
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
  let seed = 1.0

  if (experienceYears >= 10) seed += 1.5
  else if (experienceYears >= 5) seed += 1.0
  else if (experienceYears >= 3) seed += 0.7
  else if (experienceYears >= 1) seed += 0.3

  const sportsCount = getSportsCount(racquetSports)
  seed += Math.min(sportsCount * 0.2, 0.5)

  return clampRating(Math.min(seed, PROFILE_ONLY_INITIAL_RATING_CAP))
}

function getSamplesWithinWindow(
  samples: PlayerMatchSample[],
  evaluationDate: Date,
): PlayerMatchSample[] {
  return samples
    .filter((sample) => {
      const ageInDays =
        (evaluationDate.getTime() - parseSqliteDate(sample.createdAt).getTime()) /
        (1000 * 60 * 60 * 24)
      return ageInDays >= 0 && ageInDays <= MAX_MATCH_AGE_DAYS
    })
    .slice(-RECENT_MATCH_WINDOW)
}

function calculateRatingFromSamples(
  seedRating: number,
  samples: PlayerMatchSample[],
  evaluationDate: Date,
): number {
  const windowSamples = getSamplesWithinWindow(samples, evaluationDate)
  if (windowSamples.length === 0) return clampRating(seedRating)

  let weightedSum = 0
  let totalWeight = 0
  let bestMatchRating = MIN_RATING

  for (const sample of windowSamples) {
    const ageInDays = Math.max(
      0,
      (evaluationDate.getTime() - parseSqliteDate(sample.createdAt).getTime()) /
        (1000 * 60 * 60 * 24),
    )
    const recencyWeight = getRecencyWeight(ageInDays)
    const totalSampleWeight = sample.baseWeight * recencyWeight
    if (totalSampleWeight <= 0) continue

    weightedSum += sample.matchRating * totalSampleWeight
    totalWeight += totalSampleWeight
    bestMatchRating = Math.max(bestMatchRating, sample.matchRating)
  }

  if (totalWeight <= 0) return clampRating(seedRating)

  const weightedAverage = weightedSum / totalWeight
  return clampRating(weightedAverage * PEAK_AVERAGE_WEIGHT + bestMatchRating * PEAK_BEST_WEIGHT)
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
        COALESCE(tct.competition_type, 'tournament') AS competition_type,
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
      LEFT JOIN tournament_competition_types tct ON tct.tournament_id = m.tournament_id
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
  const playerSamples = new Map<string, PlayerMatchSample[]>()

  for (const [userId, seed] of seedRatings.entries()) {
    currentRatings.set(userId, clampRating(seed))
    matchesPlayed.set(userId, 0)
    matchesWon.set(userId, 0)
    playerSamples.set(userId, [])
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
        playerSamples.set(playerId, [])
      }
    }

    const totalGames = Number(match.team1_games ?? 0) + Number(match.team2_games ?? 0)
    const setCount = getSetCount(match.set_scores)
    const playerCount = allPlayers.length
    const confirmedCount = Number(match.confirmed_count ?? 0)
    const confirmationTotal = Number(match.confirmation_total ?? 0)
    const eventWeight = getEventWeight(
      match.competition_type,
      confirmedCount,
      confirmationTotal,
      playerCount,
    )

    if (totalGames <= 0 || eventWeight <= 0) continue

    const team1Rating = average(
      team1Players.map((playerId) => currentRatings.get(playerId) ?? MIN_RATING),
    )
    const team2Rating = average(
      team2Players.map((playerId) => currentRatings.get(playerId) ?? MIN_RATING),
    )

    const team1MatchRating = calculateMatchRating(
      team1Rating,
      team2Rating,
      Number(match.team1_games ?? 0),
      totalGames,
    )
    const team2MatchRating = calculateMatchRating(
      team2Rating,
      team1Rating,
      Number(match.team2_games ?? 0),
      totalGames,
    )

    const competitivenessWeight = getCompetitivenessWeight(team1Rating - team2Rating)
    const team1OpponentMatches = Math.round(
      average(team2Players.map((playerId) => matchesPlayed.get(playerId) ?? 0)),
    )
    const team2OpponentMatches = Math.round(
      average(team1Players.map((playerId) => matchesPlayed.get(playerId) ?? 0)),
    )
    const formatWeight = getFormatWeight(setCount, totalGames)
    const team1BaseWeight =
      formatWeight *
      competitivenessWeight *
      getReliabilityWeight(team1OpponentMatches) *
      eventWeight
    const team2BaseWeight =
      formatWeight *
      competitivenessWeight *
      getReliabilityWeight(team2OpponentMatches) *
      eventWeight

    const evaluationDate = parseSqliteDate(match.created_at)

    const team1Changes = team1Players.map((playerId) => {
      const oldRating = currentRatings.get(playerId) ?? MIN_RATING
      const samples = playerSamples.get(playerId) ?? []
      samples.push({
        createdAt: match.created_at,
        matchRating: team1MatchRating,
        baseWeight: team1BaseWeight,
      })
      playerSamples.set(playerId, samples)
      const seedRating = seedRatings.get(playerId) ?? MIN_RATING
      const newRating = calculateRatingFromSamples(seedRating, samples, evaluationDate)
      return { playerId, oldRating, newRating }
    })

    const team2Changes = team2Players.map((playerId) => {
      const oldRating = currentRatings.get(playerId) ?? MIN_RATING
      const samples = playerSamples.get(playerId) ?? []
      samples.push({
        createdAt: match.created_at,
        matchRating: team2MatchRating,
        baseWeight: team2BaseWeight,
      })
      playerSamples.set(playerId, samples)
      const seedRating = seedRatings.get(playerId) ?? MIN_RATING
      const newRating = calculateRatingFromSamples(seedRating, samples, evaluationDate)
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

    const team1Won = Number(match.team1_games ?? 0) > Number(match.team2_games ?? 0)
    for (const playerId of allPlayers) {
      matchesPlayed.set(playerId, (matchesPlayed.get(playerId) ?? 0) + 1)
    }
    for (const playerId of team1Won ? team1Players : team2Players) {
      matchesWon.set(playerId, (matchesWon.get(playerId) ?? 0) + 1)
    }
  }

  const now = new Date()
  for (const [userId, rating] of currentRatings.entries()) {
    const finalRating = calculateRatingFromSamples(
      seedRatings.get(userId) ?? MIN_RATING,
      playerSamples.get(userId) ?? [],
      now,
    )
    await db
      .prepare(
        "UPDATE profiles SET rating = ?, matches_played = ?, matches_won = ?, updated_at = datetime('now') WHERE user_id = ?",
      )
      .bind(
        clampRating(finalRating || rating),
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
