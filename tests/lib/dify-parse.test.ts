import { parseDifyEvent, mapSources, parseSSELines } from '@/lib/dify/parse'
import { expect, test } from 'vitest'

test('event message → delta de texte', () => {
  const e = parseDifyEvent(JSON.stringify({ event: 'message', answer: 'Bonjour', conversation_id: 'c1' }))
  expect(e.answerDelta).toBe('Bonjour')
  expect(e.conversationId).toBe('c1')
})

test('message_end → sources mappées depuis retriever_resources', () => {
  const e = parseDifyEvent(JSON.stringify({
    event: 'message_end',
    conversation_id: 'c1',
    metadata: { retriever_resources: [
      { document_name: 'Guide Encaissement v2.pdf', position: 14, dataset_name: 'Encaissement' },
    ] },
  }))
  expect(e.sources?.[0]).toEqual({ doc: 'Guide Encaissement v2.pdf', page: 'p. 14', tag: 'Encaissement' })
})

test('mapSources tolère champs manquants', () => {
  expect(mapSources([{ document_name: 'X.pdf' }])[0]).toMatchObject({ doc: 'X.pdf' })
})

test('event inconnu / JSON invalide → objet vide sans crash', () => {
  expect(parseDifyEvent('not json')).toEqual({})
  expect(parseDifyEvent(JSON.stringify({ event: 'ping' }))).toEqual({})
})

test('parseSSELines extrait les payloads data:', () => {
  const chunk = 'data: {"event":"message","answer":"a"}\n\ndata: {"event":"message","answer":"b"}\n\n'
  expect(parseSSELines(chunk)).toEqual(['{"event":"message","answer":"a"}', '{"event":"message","answer":"b"}'])
})
