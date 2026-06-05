import { beforeEach, expect, test, vi } from 'vitest'

// --- Mocks ---------------------------------------------------------------
const auth = vi.fn()
vi.mock('@/server/auth', () => ({ auth: () => auth() }))

const streamChat = vi.fn()
vi.mock('@/server/dify/client', () => ({ streamChat: (...args: unknown[]) => streamChat(...args) }))

// db is a singleton that requires DATABASE_URL + the postgres driver, so we
// mock it. The route's SELECT (load conversation id) and UPDATE (persist it)
// are fire-and-forget for streaming purposes.
const updateSet = vi.fn().mockReturnThis()
const updateWhere = vi.fn().mockResolvedValue(undefined)
const dbUpdate = vi.fn(() => ({ set: updateSet, where: updateWhere }))
const selectLimit = vi.fn().mockResolvedValue([{ difyConversationId: null }])
const dbSelect = vi.fn(() => ({
  from: () => ({ where: () => ({ limit: selectLimit }) }),
}))
vi.mock('@/server/db', () => ({
  db: { select: () => dbSelect(), update: () => dbUpdate() },
}))
vi.mock('@/server/db/schema', () => ({ users: { id: 'id', difyConversationId: 'difyConversationId' } }))

import { POST } from '@/app/api/brain/route'

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks ne purge PAS la queue mockResolvedValueOnce : un `once` non
  // consommé par un test fuirait dans le suivant. Reset complet de streamChat.
  streamChat.mockReset()
  selectLimit.mockResolvedValue([{ difyConversationId: null }])
})

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/brain', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

test('non authentifié → 401', async () => {
  auth.mockResolvedValue(null)
  const res = await POST(makeRequest({ query: 'salut' }))
  expect(res.status).toBe(401)
  expect(await res.json()).toEqual({ error: 'unauthorized' })
})

test('authentifié + streamChat ok → 200, SSE relayé octet pour octet', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })

  const sse =
    'data: {"event":"message","answer":"Bon","conversation_id":"cv-99"}\n\n' +
    'data: {"event":"message","answer":"jour"}\n\n' +
    'data: {"event":"message_end","conversation_id":"cv-99"}\n\n'

  const upstreamBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse))
      controller.close()
    },
  })
  streamChat.mockResolvedValue(new Response(upstreamBody, { status: 200 }))

  const res = await POST(makeRequest({ query: 'Comment encaisser ?' }))

  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toContain('text/event-stream')

  const relayed = await res.text()
  expect(relayed).toBe(sse)

  // conversation id was absent → an update should have been attempted.
  expect(dbUpdate).toHaveBeenCalled()
  expect(updateSet).toHaveBeenCalledWith({ difyConversationId: 'cv-99' })
})

test('query manquante → 400', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  const res = await POST(makeRequest({ query: '   ' }))
  expect(res.status).toBe(400)
})

test('upstream non-ok → 502', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  streamChat.mockResolvedValue(new Response('boom', { status: 500 }))
  const res = await POST(makeRequest({ query: 'salut' }))
  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'dify_unavailable', status: 500 })
})

test('auto-heal: 400 sur conversation existante → reset + retry → 200', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  // L'utilisateur a une conversation périmée stockée.
  selectLimit.mockResolvedValue([{ difyConversationId: 'old-cv' }])

  const sse = 'data: {"event":"message","answer":"ok","conversation_id":"new-cv"}\n\n'
  const freshBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse))
      controller.close()
    },
  })
  // 1er appel (avec old-cv) → 400 ; 2e appel (sans conversation) → 200.
  streamChat
    .mockResolvedValueOnce(new Response('bad', { status: 400 }))
    .mockResolvedValueOnce(new Response(freshBody, { status: 200 }))

  const res = await POST(makeRequest({ query: 'salut' }))

  expect(res.status).toBe(200)
  // La conversation périmée a été réinitialisée à null.
  expect(updateSet).toHaveBeenCalledWith({ difyConversationId: null })
  // streamChat rappelé une 2e fois.
  expect(streamChat).toHaveBeenCalledTimes(2)
})

test('auto-heal: 404 sur conversation existante (base Dify réinitialisée) → reset + retry → 200', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  // L'utilisateur a une conversation qui n'existe plus côté Dify.
  selectLimit.mockResolvedValue([{ difyConversationId: 'gone-cv' }])

  const sse = 'data: {"event":"message","answer":"ok","conversation_id":"new-cv"}\n\n'
  const freshBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse))
      controller.close()
    },
  })
  // 1er appel (avec gone-cv) → 404 Conversation Not Exists ; 2e appel → 200.
  streamChat
    .mockResolvedValueOnce(
      new Response('{"code":"not_found","message":"Conversation Not Exists."}', { status: 404 }),
    )
    .mockResolvedValueOnce(new Response(freshBody, { status: 200 }))

  const res = await POST(makeRequest({ query: 'salut' }))

  expect(res.status).toBe(200)
  // La conversation disparue a été réinitialisée à null.
  expect(updateSet).toHaveBeenCalledWith({ difyConversationId: null })
  // streamChat rappelé une 2e fois.
  expect(streamChat).toHaveBeenCalledTimes(2)
})

test('404 SANS conversation stockée → 502 direct, aucun retry', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  // Pas de conversation stockée : un 404 = vrai problème d'URL/config Dify.
  selectLimit.mockResolvedValue([{ difyConversationId: null }])
  streamChat.mockResolvedValue(new Response('not found', { status: 404 }))

  const res = await POST(makeRequest({ query: 'salut' }))

  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'dify_unavailable', status: 404 })
  // Aucun retry : un seul appel Dify.
  expect(streamChat).toHaveBeenCalledTimes(1)
})

test('auto-heal: 404 aussi au retry → 502, pas de boucle', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  selectLimit.mockResolvedValue([{ difyConversationId: 'gone-cv' }])
  // 404 au premier appel ET au retry sans conversation.
  streamChat
    .mockResolvedValueOnce(new Response('not found', { status: 404 }))
    .mockResolvedValueOnce(new Response('not found', { status: 404 }))

  const res = await POST(makeRequest({ query: 'salut' }))

  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'dify_unavailable', status: 404 })
  // Exactement 2 appels : l'original + UN retry, jamais plus.
  expect(streamChat).toHaveBeenCalledTimes(2)
})

test('streamChat throw → 502', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  streamChat.mockRejectedValue(new Error('network'))
  const res = await POST(makeRequest({ query: 'salut' }))
  expect(res.status).toBe(502)
})
