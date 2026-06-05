/**
 * Pure helpers for BRAIN chat-query logging: relevance threshold parsing and
 * the aggregate values inserted into `chat_queries`. No I/O here — the route
 * handler does the actual fire-and-forget INSERT.
 */

/** Parses FAQ_RELEVANCE_THRESHOLD; falls back to 0.5 on missing/invalid. */
export function relevanceThreshold(envValue: string | undefined): number {
  if (envValue === undefined || envValue === '') return 0.5
  const parsed = Number(envValue)
  return Number.isFinite(parsed) ? parsed : 0.5
}

export type ChatQueryInput = {
  query: string
  answer: string
  conversationId: string
  messageId: string
  userId: string
  scores: number[]
  threshold: number
}

export type ChatQueryValues = {
  query: string
  answer: string
  conversationId: string
  messageId: string
  userId: string
  retrievalScoreMax: number | null
  retrievalCount: number
  hasRelevantSource: boolean
}

/** Builds the `chat_queries` insert values from the captured stream data. */
export function buildChatQueryValues(input: ChatQueryInput): ChatQueryValues {
  const { scores, threshold, ...rest } = input
  const retrievalScoreMax = scores.length > 0 ? Math.max(...scores) : null
  return {
    ...rest,
    retrievalScoreMax,
    retrievalCount: scores.length,
    hasRelevantSource: retrievalScoreMax !== null && retrievalScoreMax >= threshold,
  }
}
