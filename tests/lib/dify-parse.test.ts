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
      {
        document_name: 'Guide Encaissement v2.pdf',
        position: 14,
        page: 14,
        dataset_name: 'Encaissement',
        content: 'Procédure de clôture de caisse.',
      },
    ] },
  }))
  // `position` (14) is the rank, NOT the page — page comes from the real `page` field.
  expect(e.sources?.[0]).toEqual({
    doc: 'Guide Encaissement v2.pdf',
    page: '14',
    tag: 'Encaissement',
    content: 'Procédure de clôture de caisse.',
  })
})

test('mapSources tolère champs manquants', () => {
  expect(mapSources([{ document_name: 'X.pdf' }])[0]).toMatchObject({ doc: 'X.pdf' })
})

test('mapSources : page null + position → aucune clé page', () => {
  const [s] = mapSources([{ document_name: 'X.pdf', position: 7, page: null }])
  expect(s).toEqual({ doc: 'X.pdf' })
  expect('page' in s).toBe(false)
})

test('mapSources : content porté et tronqué à ~600 chars', () => {
  const short = mapSources([{ document_name: 'X.pdf', content: '  Passage cité.  ' }])[0]
  expect(short.content).toBe('Passage cité.')

  const long = 'a'.repeat(900)
  const [truncated] = mapSources([{ document_name: 'X.pdf', content: long }])
  expect(truncated.content).toBe('a'.repeat(600) + '…')
})

test('mapSources : content vide ou non-string → aucune clé content', () => {
  expect('content' in mapSources([{ document_name: 'X.pdf', content: '   ' }])[0]).toBe(false)
  expect('content' in mapSources([{ document_name: 'X.pdf', content: 123 }])[0]).toBe(false)
})

test('event inconnu / JSON invalide → objet vide sans crash', () => {
  expect(parseDifyEvent('not json')).toEqual({})
  expect(parseDifyEvent(JSON.stringify({ event: 'ping' }))).toEqual({})
})

test('parseSSELines extrait les payloads data:', () => {
  const chunk = 'data: {"event":"message","answer":"a"}\n\ndata: {"event":"message","answer":"b"}\n\n'
  expect(parseSSELines(chunk)).toEqual(['{"event":"message","answer":"a"}', '{"event":"message","answer":"b"}'])
})

test('message_end expose messageId et les scores des sources', () => {
  const parsed = parseDifyEvent(
    JSON.stringify({
      event: 'message_end',
      id: 'msg-42',
      conversation_id: 'cv-1',
      metadata: {
        retriever_resources: [
          { document_name: 'a.pdf', score: 0.82 },
          { document_name: 'b.pdf', score: 0.31 },
        ],
      },
    }),
  )
  expect(parsed.messageId).toBe('msg-42')
  expect(parsed.scores).toEqual([0.82, 0.31])
})

test('message_end sans sources → scores vide, messageId absent si id manquant', () => {
  const parsed = parseDifyEvent(
    JSON.stringify({ event: 'message_end', conversation_id: 'cv-1', metadata: {} }),
  )
  expect(parsed.scores).toEqual([])
  expect(parsed.messageId).toBeUndefined()
})

test('message_end ignore les scores non numériques', () => {
  const parsed = parseDifyEvent(
    JSON.stringify({
      event: 'message_end',
      id: 'msg-1',
      metadata: { retriever_resources: [{ score: 'high' }, { score: 0.6 }, {}] },
    }),
  )
  expect(parsed.scores).toEqual([0.6])
})
