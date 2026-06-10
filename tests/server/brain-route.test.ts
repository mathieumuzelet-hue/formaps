import { beforeEach, expect, test, vi } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'

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
const insertValues = vi.fn().mockResolvedValue(undefined)
const dbInsert = vi.fn(() => ({ values: insertValues }))
vi.mock('@/server/db', () => ({
  db: { select: () => dbSelect(), update: () => dbUpdate(), insert: () => dbInsert() },
}))
vi.mock('@/server/db/schema', () => ({
  users: { id: 'id', difyConversationId: 'difyConversationId' },
  chatQueries: {},
}))

import { POST } from '@/app/api/brain/route'
import { users } from '@/server/db/schema'

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks ne purge PAS la queue mockResolvedValueOnce : un `once` non
  // consommé par un test fuirait dans le suivant. Reset complet de streamChat.
  streamChat.mockReset()
  selectLimit.mockResolvedValue([{ difyConversationId: null }])
  delete process.env.FAQ_RELEVANCE_THRESHOLD
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
    'data: {"event":"message_end","id":"msg-99","conversation_id":"cv-99"}\n\n'

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

  // conversation id was absent → an update should have been attempted at
  // message_end (NOT at the first delta), with a write-once where clause.
  expect(dbUpdate).toHaveBeenCalled()
  expect(updateSet).toHaveBeenCalledWith({ difyConversationId: 'cv-99' })
  expect(updateWhere).toHaveBeenCalledWith(
    and(eq(users.id, 'u1'), isNull(users.difyConversationId)),
  )
})

test('persistance UNIQUEMENT au message_end : un event error après les deltas → pas de persist', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  // Pas de conversation stockée : Dify en crée une, le modèle streame, PUIS échoue.
  selectLimit.mockResolvedValue([{ difyConversationId: null }])
  const sse =
    'data: {"event":"message","answer":"début","conversation_id":"cv-poison"}\n\n' +
    'data: {"event":"error","message":"provider down"}\n\n' +
    'data: {"event":"message_end","id":"msg-1","conversation_id":"cv-poison"}\n\n'
  streamChat.mockResolvedValue(new Response(streamFrom(sse), { status: 200 }))

  const res = await POST(makeRequest({ query: 'salut' }))
  expect(res.status).toBe(200)
  await res.text()
  await new Promise((r) => setTimeout(r, 0))

  // L'id de la conversation empoisonnée n'est JAMAIS persisté : seule la
  // purge à null a lieu (les deux UPDATEs fire-and-forget ne sont pas
  // ordonnés ; persister au premier delta pouvait stocker un id poison).
  expect(updateSet).not.toHaveBeenCalledWith({ difyConversationId: 'cv-poison' })
  expect(updateSet).toHaveBeenCalledWith({ difyConversationId: null })
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

test('auto-heal discriminé : 400 invalid_param sur conversation existante → 502 SANS purge ni retry', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  // L'utilisateur a une conversation stockée parfaitement valide.
  selectLimit.mockResolvedValue([{ difyConversationId: 'cv-valide' }])
  // 400 SANS rapport avec la conversation (mauvais input, config app…).
  streamChat.mockResolvedValue(
    new Response('{"code":"invalid_param","message":"var x is required"}', { status: 400 }),
  )

  const res = await POST(makeRequest({ query: 'salut' }))

  expect(res.status).toBe(502)
  expect(await res.json()).toEqual({ error: 'dify_unavailable', status: 400 })
  // Le contexte de conversation de l'utilisateur est PRÉSERVÉ.
  expect(updateSet).not.toHaveBeenCalledWith({ difyConversationId: null })
  // Et aucun retry inutile.
  expect(streamChat).toHaveBeenCalledTimes(1)
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

test('passe un AbortSignal à streamChat (timeout connexion + abort client)', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  const sse = 'data: {"event":"message","answer":"ok","conversation_id":"cv-1"}\n\n'
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse))
      controller.close()
    },
  })
  streamChat.mockResolvedValue(new Response(body, { status: 200 }))

  const res = await POST(makeRequest({ query: 'hello' }))
  expect(res.status).toBe(200)

  const args = streamChat.mock.calls[0][0] as { signal?: unknown }
  expect(args.signal).toBeInstanceOf(AbortSignal)
})

test('abort client AVANT les headers → propagé au fetch Dify → 502', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  const clientAbort = new AbortController()
  streamChat.mockImplementation((args: { signal?: AbortSignal }) => {
    // Le client se déconnecte pendant la phase headers.
    clientAbort.abort()
    // Avec le plumbing, le signal relayé est déjà aborté → fetch rejette
    // (comportement undici). Sans plumbing, l'abort est invisible et Dify
    // « répond » normalement.
    if (args.signal?.aborted) return Promise.reject(new Error('This operation was aborted'))
    return Promise.resolve(
      new Response(streamFrom('data: {"event":"message","answer":"ok"}\n\n'), { status: 200 }),
    )
  })

  const request = new Request('http://localhost/api/brain', {
    method: 'POST',
    body: JSON.stringify({ query: 'hello' }),
    headers: { 'Content-Type': 'application/json' },
    signal: clientAbort.signal,
  })

  const res = await POST(request)
  // L'abort pré-stream tombe dans le catch existant → 502, pas de pendaison.
  expect(res.status).toBe(502)
})

test('signal client DÉJÀ aborté avant POST → streamChat reçoit un signal aborté → 502 immédiat', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  // Le client est parti AVANT même l'appel : addEventListener('abort') ne
  // refire pas sur un signal déjà aborté (spec AbortSignal), le controller
  // doit donc être aborté explicitement à la création.
  const clientAbort = new AbortController()
  clientAbort.abort()

  streamChat.mockImplementation((args: { signal?: AbortSignal }) => {
    // Comportement undici : fetch avec un signal déjà aborté rejette direct.
    if (args.signal?.aborted) return Promise.reject(new Error('This operation was aborted'))
    return Promise.resolve(
      new Response(streamFrom('data: {"event":"message","answer":"ok"}\n\n'), { status: 200 }),
    )
  })

  const request = new Request('http://localhost/api/brain', {
    method: 'POST',
    body: JSON.stringify({ query: 'hello' }),
    headers: { 'Content-Type': 'application/json' },
    signal: clientAbort.signal,
  })

  const res = await POST(request)
  expect(res.status).toBe(502)
  const args = streamChat.mock.calls[0][0] as { signal: AbortSignal }
  expect(args.signal.aborted).toBe(true)
})

test('Dify muet pendant la phase headers → timeout de connexion 30 s → 502', async () => {
  vi.useFakeTimers()
  try {
    auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
    // Dify accepte la connexion mais n'envoie jamais les headers : la
    // promesse ne se résout que si le signal du caller est aborté.
    streamChat.mockImplementation(
      (args: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          args.signal?.addEventListener(
            'abort',
            () => reject(new Error('The operation timed out')),
            { once: true },
          )
        }),
    )

    const resPromise = POST(makeRequest({ query: 'hello' }))
    await vi.advanceTimersByTimeAsync(30_000)
    const res = await resPromise
    expect(res.status).toBe(502)
  } finally {
    vi.useRealTimers()
  }
})

test('le timer 30 s ne couvre QUE les headers : une génération longue n’est jamais coupée mid-stream', async () => {
  vi.useFakeTimers()
  try {
    auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
    // Mock fidèle à undici : aborter le signal APRÈS les headers erre le body
    // en cours de lecture. Si le timer de connexion n'était pas cleared à
    // l'arrivée des headers, l'avance de 30 s ci-dessous couperait le stream.
    let push!: (s: string) => void
    let close!: () => void
    streamChat.mockImplementation((args: { signal?: AbortSignal }) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          args.signal?.addEventListener(
            'abort',
            () => controller.error(new Error('This operation was aborted')),
            { once: true },
          )
          push = (s) => controller.enqueue(new TextEncoder().encode(s))
          close = () => controller.close()
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    })

    const res = await POST(makeRequest({ query: 'hello' }))
    expect(res.status).toBe(200)

    // Headers arrivés, la génération démarre…
    push('data: {"event":"message","answer":"longue","conversation_id":"cv-1"}\n\n')
    // …et dépasse largement la fenêtre de connexion de 30 s.
    await vi.advanceTimersByTimeAsync(30_000)
    push('data: {"event":"message","answer":" génération"}\n\n')
    close()

    // Le body n'a été ni coupé ni mis en erreur : tout est relayé.
    const relayed = await res.text()
    expect(relayed).toContain('longue')
    expect(relayed).toContain(' génération')
  } finally {
    vi.useRealTimers()
  }
})

test('streamChat throw → 502', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  streamChat.mockRejectedValue(new Error('network'))
  const res = await POST(makeRequest({ query: 'salut' }))
  expect(res.status).toBe(502)
})

function streamFrom(sse: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse))
      controller.close()
    },
  })
}

test('log : insert chat_queries avec les agrégats après message_end', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  const sse =
    'data: {"event":"message","answer":"Bon","conversation_id":"cv-9"}\n\n' +
    'data: {"event":"message","answer":"jour"}\n\n' +
    'data: {"event":"message_end","id":"msg-7","conversation_id":"cv-9","metadata":{"retriever_resources":[{"score":0.82},{"score":0.3}]}}\n\n'
  streamChat.mockResolvedValue(new Response(streamFrom(sse), { status: 200 }))

  const res = await POST(makeRequest({ query: 'Comment encaisser ?' }))
  await res.text() // drains the stream → triggers flush()
  // flush() inserts fire-and-forget: let the microtask resolve.
  await new Promise((r) => setTimeout(r, 0))

  expect(insertValues).toHaveBeenCalledWith({
    query: 'Comment encaisser ?',
    answer: 'Bonjour',
    conversationId: 'cv-9',
    messageId: 'msg-7',
    userId: 'u1',
    retrievalScoreMax: 0.82,
    retrievalCount: 2,
    hasRelevantSource: true,
  })
})

test('log : seuil FAQ_RELEVANCE_THRESHOLD personnalisé respecté', async () => {
  process.env.FAQ_RELEVANCE_THRESHOLD = '0.9'
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  const sse =
    'data: {"event":"message_end","id":"msg-1","conversation_id":"cv-1","metadata":{"retriever_resources":[{"score":0.82}]}}\n\n'
  streamChat.mockResolvedValue(new Response(streamFrom(sse), { status: 200 }))

  const res = await POST(makeRequest({ query: 'q' }))
  await res.text()
  await new Promise((r) => setTimeout(r, 0))

  expect(insertValues).toHaveBeenCalledWith(
    expect.objectContaining({ hasRelevantSource: false, retrievalScoreMax: 0.82 }),
  )
})

test('log : pas d’insert si le stream se termine sans message_end', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  const sse = 'data: {"event":"message","answer":"partiel","conversation_id":"cv-1"}\n\n'
  streamChat.mockResolvedValue(new Response(streamFrom(sse), { status: 200 }))

  const res = await POST(makeRequest({ query: 'q' }))
  await res.text()
  await new Promise((r) => setTimeout(r, 0))

  expect(insertValues).not.toHaveBeenCalled()
})

test('self-heal : event error dans le stream sur conversation existante → reset dify_conversation_id', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  // L'utilisateur a une conversation stockée, désormais empoisonnée côté Dify
  // (message assistant vide après une panne provider).
  selectLimit.mockResolvedValue([{ difyConversationId: 'cv-poison' }])
  const sse =
    'data: {"event":"error","message":"Assistant message must have either content or tool_calls, but not none."}\n\n'
  streamChat.mockResolvedValue(new Response(streamFrom(sse), { status: 200 }))

  const res = await POST(makeRequest({ query: 'salut' }))
  expect(res.status).toBe(200)
  // Les octets sont relayés tels quels (le client affiche l'erreur).
  expect(await res.text()).toBe(sse)
  await new Promise((r) => setTimeout(r, 0))

  // La conversation empoisonnée a été purgée : la prochaine question repart propre.
  expect(updateSet).toHaveBeenCalledWith({ difyConversationId: null })
})

test('self-heal : event error sur NOUVELLE conversation → l’id capturé n’est pas conservé', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  // Pas de conversation stockée : Dify en crée une, puis le modèle échoue.
  selectLimit.mockResolvedValue([{ difyConversationId: null }])
  const sse =
    'data: {"event":"error","message":"quota exceeded","conversation_id":"cv-naissante"}\n\n' +
    'data: {"event":"message","answer":"","conversation_id":"cv-naissante"}\n\n'
  streamChat.mockResolvedValue(new Response(streamFrom(sse), { status: 200 }))

  const res = await POST(makeRequest({ query: 'salut' }))
  expect(res.status).toBe(200)
  await res.text()
  await new Promise((r) => setTimeout(r, 0))

  // Jamais persisté l'id d'une conversation née en erreur.
  expect(updateSet).not.toHaveBeenCalledWith({ difyConversationId: 'cv-naissante' })
})

test('log : un échec d’insert n’affecte ni le statut ni les octets relayés', async () => {
  auth.mockResolvedValue({ user: { id: 'u1', role: 'employee', storeId: null, firstName: 'Léa' } })
  insertValues.mockRejectedValueOnce(new Error('db down'))
  const sse =
    'data: {"event":"message","answer":"ok","conversation_id":"cv-1"}\n\n' +
    'data: {"event":"message_end","id":"msg-1","conversation_id":"cv-1","metadata":{}}\n\n'
  streamChat.mockResolvedValue(new Response(streamFrom(sse), { status: 200 }))

  const res = await POST(makeRequest({ query: 'q' }))
  expect(res.status).toBe(200)
  expect(await res.text()).toBe(sse)
})
