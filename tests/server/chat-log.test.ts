import { expect, test } from 'vitest'

import { relevanceThreshold, buildChatQueryValues } from '@/server/brain/chat-log'

test('relevanceThreshold : défaut 0.5 quand non défini ou invalide', () => {
  expect(relevanceThreshold(undefined)).toBe(0.5)
  expect(relevanceThreshold('')).toBe(0.5)
  expect(relevanceThreshold('abc')).toBe(0.5)
})

test('relevanceThreshold : valeur env respectée, y compris 0', () => {
  expect(relevanceThreshold('0.7')).toBe(0.7)
  expect(relevanceThreshold('0')).toBe(0)
})

test('buildChatQueryValues : agrégats avec sources', () => {
  const values = buildChatQueryValues({
    query: 'q',
    answer: 'a',
    conversationId: 'cv-1',
    messageId: 'msg-1',
    userId: 'u1',
    scores: [0.3, 0.82, 0.5],
    threshold: 0.5,
  })
  expect(values).toEqual({
    query: 'q',
    answer: 'a',
    conversationId: 'cv-1',
    messageId: 'msg-1',
    userId: 'u1',
    retrievalScoreMax: 0.82,
    retrievalCount: 3,
    hasRelevantSource: true,
  })
})

test('buildChatQueryValues : aucune source → scoreMax null, non pertinent', () => {
  const values = buildChatQueryValues({
    query: 'q', answer: 'a', conversationId: 'cv', messageId: 'm', userId: 'u',
    scores: [], threshold: 0.5,
  })
  expect(values.retrievalScoreMax).toBeNull()
  expect(values.retrievalCount).toBe(0)
  expect(values.hasRelevantSource).toBe(false)
})

test('buildChatQueryValues : scoreMax strictement sous le seuil → non pertinent', () => {
  const values = buildChatQueryValues({
    query: 'q', answer: 'a', conversationId: 'cv', messageId: 'm', userId: 'u',
    scores: [0.49], threshold: 0.5,
  })
  expect(values.hasRelevantSource).toBe(false)
})
