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
  expect(await res.json()).toEqual({ error: 'dify_unavailable' })
})

test('streamChat throw → 502', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  streamChat.mockRejectedValue(new Error('network'))
  const res = await POST(makeRequest({ query: 'salut' }))
  expect(res.status).toBe(502)
})
