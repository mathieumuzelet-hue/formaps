# BRAIN FAQ-gaps — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Logger chaque question BRAIN avec les métadonnées de récupération Dify et le feedback utilisateur, et exposer une vue admin `/admin/faq-gaps` des questions sans réponse pertinente.

**Architecture:** Capture non-bloquante dans le `TransformStream` inspecteur existant de `/api/brain` (insert au `flush()`), mutation tRPC `brain.feedback` avec relais Dify best-effort, boutons 👍/👎 dans le chat, vue admin avec regroupement par question normalisée + export CSV. Spec : `docs/superpowers/specs/2026-06-05-brain-faq-gaps-design.md`.

**Tech Stack:** Next.js 16 App Router, tRPC v11, Drizzle/Postgres, vitest + @testing-library/react. Tests DB toujours mockés (pattern `tests/server/brain-route.test.ts`).

**Conventions:**
- TDD strict : test d'abord, le voir échouer, implémenter, le voir passer, committer.
- Suite : `pnpm vitest run <fichier>` pour un fichier, `pnpm test` + `pnpm lint` avant chaque commit.
- Code/commits en anglais, UI en français.

---

### Task 1 : Table `chat_queries` (schéma + migration)

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: `drizzle/0003_*.sql` (généré)

Schéma déclaratif : pas de test unitaire (exception TDD config). La migration est validée par inspection du SQL généré.

- [ ] **Step 1 : Ajouter la table au schéma**

Dans `src/server/db/schema.ts`, étendre l'import drizzle et ajouter la table à la fin du fichier :

```ts
// ligne 1 — ajouter `real` et `index` :
import { pgTable, uuid, text, integer, date, timestamp, boolean, pgEnum, unique, real, index } from 'drizzle-orm/pg-core'
```

```ts
/**
 * One row per BRAIN question/answer, with Dify retrieval metadata and user
 * feedback. Feeds the /admin/faq-gaps view. Inserted fire-and-forget by
 * /api/brain — never blocks the chat response.
 */
export const chatQueries = pgTable('chat_queries', {
  id: uuid('id').primaryKey().defaultRandom(),
  query: text('query').notNull(),
  answer: text('answer').notNull(),
  conversationId: text('conversation_id').notNull(),
  messageId: text('message_id').notNull().unique(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  retrievalScoreMax: real('retrieval_score_max'),
  retrievalCount: integer('retrieval_count').notNull(),
  hasRelevantSource: boolean('has_relevant_source').notNull(),
  feedback: text('feedback'), // 'like' | 'dislike' | null
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  createdAtIdx: index('chat_queries_created_at_idx').on(t.createdAt),
  hasRelevantSourceIdx: index('chat_queries_has_relevant_source_idx').on(t.hasRelevantSource),
  feedbackIdx: index('chat_queries_feedback_idx').on(t.feedback),
}))
```

- [ ] **Step 2 : Générer la migration**

Run: `pnpm drizzle-kit generate`
Expected: nouveau fichier `drizzle/0003_<nom>.sql` contenant `CREATE TABLE "chat_queries"` + 3 `CREATE INDEX` + la FK vers users. Vérifier qu'il ne contient AUCUN `ALTER`/`DROP` sur les tables existantes.

- [ ] **Step 3 : Vérifier que la suite reste verte**

Run: `pnpm test`
Expected: tous verts (la table n'est encore consommée nulle part).

- [ ] **Step 4 : Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(db): chat_queries table for BRAIN question logging"
```

---

### Task 2 : `parseDifyEvent` expose `messageId` + `scores` au `message_end`

**Files:**
- Modify: `src/lib/dify/parse.ts`
- Test: `tests/lib/dify-parse.test.ts` (existant)

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `tests/lib/dify-parse.test.ts` :

```ts
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
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm vitest run tests/lib/dify-parse.test.ts`
Expected: FAIL — `messageId`/`scores` undefined.

- [ ] **Step 3 : Implémenter**

Dans `src/lib/dify/parse.ts` : étendre le type et le case `message_end` :

```ts
export type DifyParsed = {
  answerDelta?: string
  sources?: BrainSource[]
  conversationId?: string
  /** Dify message id (`id` of message_end) — keys the feedback round-trip. */
  messageId?: string
  /** Numeric `score` of each retriever resource (non-numeric entries dropped). */
  scores?: number[]
  /** Set when Dify streams an `error` event (model failure, quota, etc.). */
  error?: string
}
```

```ts
    case 'message_end': {
      const metadata = (obj.metadata ?? {}) as Record<string, unknown>
      const resources = Array.isArray(metadata.retriever_resources)
        ? (metadata.retriever_resources as Array<Record<string, unknown>>)
        : []
      const result: DifyParsed = {
        sources: mapSources(resources),
        scores: resources
          .map((r) => r.score)
          .filter((s): s is number => typeof s === 'number' && Number.isFinite(s)),
      }
      if (typeof obj.conversation_id === 'string') {
        result.conversationId = obj.conversation_id
      }
      if (typeof obj.id === 'string') {
        result.messageId = obj.id
      }
      return result
    }
```

- [ ] **Step 4 : Vérifier le passage**

Run: `pnpm vitest run tests/lib/dify-parse.test.ts`
Expected: PASS, anciens tests inclus (rétro-compat).

- [ ] **Step 5 : Commit**

```bash
git add src/lib/dify/parse.ts tests/lib/dify-parse.test.ts
git commit -m "feat(dify): expose messageId and retrieval scores on message_end"
```

---

### Task 3 : Helpers de log `src/server/brain/chat-log.ts`

**Files:**
- Create: `src/server/brain/chat-log.ts`
- Test: `tests/server/chat-log.test.ts`

Fonctions pures : seuil env + agrégats d'insert. Testables sans mock de route.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `tests/server/chat-log.test.ts` :

```ts
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
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm vitest run tests/server/chat-log.test.ts`
Expected: FAIL — module inexistant.

- [ ] **Step 3 : Implémenter**

Créer `src/server/brain/chat-log.ts` :

```ts
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
```

- [ ] **Step 4 : Vérifier le passage**

Run: `pnpm vitest run tests/server/chat-log.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/server/brain/chat-log.ts tests/server/chat-log.test.ts
git commit -m "feat(brain): pure chat-query logging helpers (threshold + aggregates)"
```

---

### Task 4 : Capture dans `/api/brain` (insert au flush)

**Files:**
- Modify: `src/app/api/brain/route.ts`
- Modify: `tests/server/brain-route.test.ts`
- Modify: `.env.example` (variable `FAQ_RELEVANCE_THRESHOLD`)

L'inspecteur `TransformStream` parse désormais TOUTES les frames (aujourd'hui il s'arrête après la capture du conversation id) : il accumule l'`answer`, capture `messageId` + `scores` au `message_end`, et `flush()` insère en fire-and-forget.

- [ ] **Step 1 : Étendre le mock db du test avec `insert`**

Dans `tests/server/brain-route.test.ts`, remplacer le bloc mock db (lignes ~13-23) par :

```ts
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
```

Et dans le `beforeEach`, ajouter `delete process.env.FAQ_RELEVANCE_THRESHOLD`.

- [ ] **Step 2 : Écrire les tests qui échouent**

Ajouter à `tests/server/brain-route.test.ts` (le helper `streamFrom` factorise la création du body) :

```ts
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
  await res.text() // draine le stream → déclenche flush()
  // flush() insère en fire-and-forget : laisser la microtask se résoudre.
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
```

- [ ] **Step 3 : Vérifier l'échec**

Run: `pnpm vitest run tests/server/brain-route.test.ts`
Expected: FAIL — `insertValues` jamais appelé (les 2 derniers peuvent passer : c'est le comportement préservé, OK).

- [ ] **Step 4 : Implémenter la capture**

Dans `src/app/api/brain/route.ts` :

Ajouter les imports :

```ts
import { chatQueries } from '@/server/db/schema' // étendre l'import users existant
import { relevanceThreshold, buildChatQueryValues } from '@/server/brain/chat-log'
```

Remplacer le bloc inspecteur (de `const decoder = new TextDecoder()` jusqu'à la fin du `TransformStream`) par :

```ts
  // Relay the SSE stream untouched, while inspecting frames to capture the
  // conversation id Dify assigns (new conversations), the full answer, and
  // the message_end retrieval metadata for the chat_queries log. Each chunk
  // is enqueued unchanged immediately; only the inspection side buffers.
  const decoder = new TextDecoder()
  const hadConversationId = conversationId != null
  let capturedConversationId = false
  let buffer = ''

  // Accumulated for the fire-and-forget chat_queries INSERT in flush().
  let answer = ''
  let endMessageId: string | null = null
  let endScores: number[] | null = null
  let streamConversationId = conversationId

  const inspectFrames = (complete: string) => {
    for (const payload of parseSSELines(complete)) {
      const parsed = parseDifyEvent(payload)
      if (parsed.answerDelta) answer += parsed.answerDelta
      if (parsed.messageId) endMessageId = parsed.messageId
      if (parsed.scores) endScores = parsed.scores
      if (parsed.conversationId) {
        streamConversationId = parsed.conversationId
        if (!hadConversationId && !capturedConversationId) {
          capturedConversationId = true
          const newId = parsed.conversationId
          // Fire-and-forget: don't await, don't break the stream on error.
          void Promise.resolve(
            db.update(users).set({ difyConversationId: newId }).where(eq(users.id, userId)),
          ).catch(() => {})
        }
      }
    }
  }

  const inspector = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Pass through immediately — never block the client on inspection.
      controller.enqueue(chunk)
      try {
        buffer += decoder.decode(chunk, { stream: true })
        // Only parse up to the last frame delimiter; keep the incomplete tail.
        const lastDelimiter = buffer.lastIndexOf('\n\n')
        if (lastDelimiter === -1) return
        const complete = buffer.slice(0, lastDelimiter)
        buffer = buffer.slice(lastDelimiter + 2)
        inspectFrames(complete)
      } catch {
        // Inspection failures must never affect the relayed bytes.
      }
    },
    flush() {
      try {
        // Parse any trailing frame not terminated by a blank line.
        buffer += decoder.decode()
        if (buffer.trim().length > 0) inspectFrames(buffer)

        // Only log complete answers: a stream without message_end (network
        // cut, model error) is noise for FAQ analysis.
        if (!endMessageId || endScores === null || !streamConversationId) return
        const values = buildChatQueryValues({
          query,
          answer,
          conversationId: streamConversationId,
          messageId: endMessageId,
          userId,
          scores: endScores,
          threshold: relevanceThreshold(process.env.FAQ_RELEVANCE_THRESHOLD),
        })
        // Fire-and-forget: logging must never delay or fail the response.
        void Promise.resolve(db.insert(chatQueries).values(values)).catch((err) => {
          console.error('[brain] log chat_queries a échoué:', err)
        })
      } catch (err) {
        console.error('[brain] inspection finale a échoué:', err)
      }
    },
  })
```

Note : la variable `captured`/`hadConversationId` d'origine est remplacée par ce bloc — l'update du `difyConversationId` garde exactement la même sémantique (une seule fois, seulement si la conversation était absente).

- [ ] **Step 5 : Vérifier le passage + suite complète**

Run: `pnpm vitest run tests/server/brain-route.test.ts` puis `pnpm test`
Expected: PASS partout (les tests existants de relais/auto-heal restent verts).

- [ ] **Step 6 : Ajouter la variable à `.env.example`**

Après le bloc Dify :

```
# Seuil de pertinence des sources pour le log FAQ (0..1). Une question dont la
# meilleure source est sous ce seuil est marquée "sans réponse pertinente".
FAQ_RELEVANCE_THRESHOLD=0.5
```

- [ ] **Step 7 : Commit**

```bash
git add src/app/api/brain/route.ts tests/server/brain-route.test.ts .env.example
git commit -m "feat(brain): log chat queries with retrieval metadata on stream end"
```

---

### Task 5 : Client Dify — `sendFeedback`

**Files:**
- Modify: `src/server/dify/client.ts`
- Test: `tests/server/dify-feedback.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `tests/server/dify-feedback.test.ts` :

```ts
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { sendFeedback } from '@/server/dify/client'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  process.env.DIFY_API_URL = 'http://dify:5001/v1'
  process.env.DIFY_API_KEY = 'app-key'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('POST sur /v1/messages/{id}/feedbacks avec rating + user, sans double /v1', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

  await sendFeedback({ messageId: 'msg-7', rating: 'like', user: 'u1' })

  expect(fetchMock).toHaveBeenCalledWith(
    'http://dify:5001/v1/messages/msg-7/feedbacks',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer app-key' }),
      body: JSON.stringify({ rating: 'like', user: 'u1' }),
    }),
  )
})

test('réponse non-ok → throw (le caller décide du best-effort)', async () => {
  fetchMock.mockResolvedValue(new Response('nope', { status: 400 }))
  await expect(
    sendFeedback({ messageId: 'msg-7', rating: 'dislike', user: 'u1' }),
  ).rejects.toThrow()
})

test('env manquante → throw', async () => {
  delete process.env.DIFY_API_URL
  await expect(
    sendFeedback({ messageId: 'm', rating: 'like', user: 'u' }),
  ).rejects.toThrow()
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm vitest run tests/server/dify-feedback.test.ts`
Expected: FAIL — `sendFeedback` n'existe pas.

- [ ] **Step 3 : Implémenter (en extrayant la normalisation d'URL, DRY avec `streamChat`)**

Dans `src/server/dify/client.ts` :

```ts
/** Resolves env config and the normalized base URL (no trailing slash/v1). */
function difyConfig(): { base: string; apiKey: string } {
  const apiUrl = process.env.DIFY_API_URL
  const apiKey = process.env.DIFY_API_KEY
  if (!apiUrl || !apiKey) {
    throw new Error('DIFY_API_URL and DIFY_API_KEY must be set')
  }
  // Tolerate both base URL forms: Dify shows `https://host/v1` but we append
  // `/v1/...` ourselves — strip a trailing slash and a trailing `/v1`.
  const base = apiUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  return { base, apiKey }
}

type SendFeedbackArgs = {
  messageId: string
  rating: 'like' | 'dislike'
  user: string
}

/**
 * Relays a user feedback to Dify so both systems stay consistent. Throws on
 * missing env or non-ok response — callers treat it as best-effort.
 */
export async function sendFeedback({ messageId, rating, user }: SendFeedbackArgs): Promise<void> {
  const { base, apiKey } = difyConfig()
  const res = await fetch(`${base}/v1/messages/${encodeURIComponent(messageId)}/feedbacks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rating, user }),
  })
  if (!res.ok) {
    throw new Error(`Dify feedback failed: ${res.status}`)
  }
}
```

Et refactorer `streamChat` pour utiliser `difyConfig()` (supprimer le bloc env/base dupliqué) :

```ts
export async function streamChat({ query, user, conversationId }: StreamChatArgs): Promise<Response> {
  const { base, apiKey } = difyConfig()
  return fetch(`${base}/v1/chat-messages`, {
    // ... reste inchangé (headers avec apiKey, body identique)
  })
}
```

- [ ] **Step 4 : Vérifier le passage + suite**

Run: `pnpm vitest run tests/server/dify-feedback.test.ts` puis `pnpm test`
Expected: PASS (brain-route mocke `streamChat`, donc le refactor est sans impact).

- [ ] **Step 5 : Commit**

```bash
git add src/server/dify/client.ts tests/server/dify-feedback.test.ts
git commit -m "feat(dify): sendFeedback client and shared base-url config"
```

---

### Task 6 : Mutation tRPC `brain.feedback`

**Files:**
- Modify: `src/server/trpc/routers/brain.ts`
- Test: `tests/server/brain-feedback.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `tests/server/brain-feedback.test.ts` :

```ts
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))

const sendFeedback = vi.fn()
vi.mock('@/server/dify/client', () => ({
  sendFeedback: (...args: unknown[]) => sendFeedback(...args),
}))

const updateWhere = vi.fn()
const updateSet = vi.fn(() => ({ where: updateWhere }))
const dbUpdate = vi.fn(() => ({ set: updateSet }))
const dbMock = { update: dbUpdate } as never

vi.mock('@/server/db', () => ({ db: {} }))

import { brainRouter } from '@/server/trpc/routers/brain'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(brainRouter)

function caller(userId = 'u1') {
  return createCaller({
    session: {
      user: { id: userId, role: 'employee', storeId: null, firstName: 'Léa', email: 'a@b.fr' },
      expires: '',
    },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  // returning() résout avec la ligne mise à jour (ownership OK par défaut).
  updateWhere.mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'cq-1' }]) })
  sendFeedback.mockResolvedValue(undefined)
})

test('update le feedback et relaie à Dify', async () => {
  await caller().feedback({ messageId: 'msg-7', feedback: 'dislike' })

  expect(updateSet).toHaveBeenCalledWith({ feedback: 'dislike' })
  expect(sendFeedback).toHaveBeenCalledWith({ messageId: 'msg-7', rating: 'dislike', user: 'u1' })
})

test('message inconnu ou appartenant à un autre user → NOT_FOUND, pas de relais', async () => {
  updateWhere.mockReturnValue({ returning: vi.fn().mockResolvedValue([]) })

  await expect(caller().feedback({ messageId: 'other', feedback: 'like' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
  expect(sendFeedback).not.toHaveBeenCalled()
})

test('échec du relais Dify → la mutation réussit quand même', async () => {
  sendFeedback.mockRejectedValue(new Error('dify down'))

  const result = await caller().feedback({ messageId: 'msg-7', feedback: 'like' })
  expect(result).toEqual({ ok: true })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm vitest run tests/server/brain-feedback.test.ts`
Expected: FAIL — `feedback` n'existe pas sur le router.

- [ ] **Step 3 : Implémenter**

Dans `src/server/trpc/routers/brain.ts` :

```ts
import { and, asc, eq } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { brainSuggestions, chatQueries } from '@/server/db/schema'
import { sendFeedback } from '@/server/dify/client'
import { protectedProcedure, router } from '../trpc'

export const brainRouter = router({
  /** Active suggestions, in display order. */
  suggestions: protectedProcedure.query(async ({ ctx }) => {
    // ... existant, inchangé
  }),

  /**
   * Records a 👍/👎 on one of the CURRENT user's answers, then relays it to
   * Dify best-effort (local row is the source of truth for /admin/faq-gaps).
   */
  feedback: protectedProcedure
    .input(z.object({ messageId: z.string().min(1), feedback: z.enum(['like', 'dislike']) }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .update(chatQueries)
        .set({ feedback: input.feedback })
        .where(and(eq(chatQueries.messageId, input.messageId), eq(chatQueries.userId, ctx.user.id)))
        .returning({ id: chatQueries.id })

      if (rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Message introuvable' })
      }

      try {
        await sendFeedback({ messageId: input.messageId, rating: input.feedback, user: ctx.user.id })
      } catch (err) {
        console.error('[brain] relais feedback Dify a échoué:', err)
      }

      return { ok: true }
    }),
})
```

- [ ] **Step 4 : Vérifier le passage + suite**

Run: `pnpm vitest run tests/server/brain-feedback.test.ts` puis `pnpm test`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/server/trpc/routers/brain.ts tests/server/brain-feedback.test.ts
git commit -m "feat(brain): feedback mutation with ownership check and Dify relay"
```

---

### Task 7 : `useBrainChat` capture le `messageId`

**Files:**
- Modify: `src/lib/brain/useBrainChat.ts`
- Test: `src/lib/brain/useBrainChat.test.ts` (existant, co-localisé)

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `src/lib/brain/useBrainChat.test.ts` :

```ts
test('reduceFrame pose le messageId du message_end sur le message ai', () => {
  const frame =
    'data: {"event":"message_end","id":"msg-7","conversation_id":"cv-1","metadata":{"retriever_resources":[]}}'
  const next = reduceFrame({ role: 'ai', text: 'réponse' }, frame)
  expect(next.messageId).toBe('msg-7')
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm vitest run src/lib/brain/useBrainChat.test.ts`
Expected: FAIL — `messageId` undefined.

- [ ] **Step 3 : Implémenter**

Dans `src/lib/brain/useBrainChat.ts` :

```ts
export type BrainMessage = {
  role: 'user' | 'ai'
  text: string
  sources?: BrainSource[]
  /** Dify message id, set at message_end — keys the 👍/👎 feedback. */
  messageId?: string
}
```

Et dans `reduceFrame`, après le bloc `sources` :

```ts
    if (parsed.messageId) {
      next = { ...next, messageId: parsed.messageId }
    }
```

- [ ] **Step 4 : Vérifier le passage**

Run: `pnpm vitest run src/lib/brain/useBrainChat.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/brain/useBrainChat.ts src/lib/brain/useBrainChat.test.ts
git commit -m "feat(brain): carry Dify messageId onto streamed ai messages"
```

---

### Task 8 : Boutons 👍/👎 (`FeedbackButtons` + intégration `BrainChat`)

**Files:**
- Create: `src/components/brain/FeedbackButtons.tsx`
- Modify: `src/components/ui/Icon.tsx` (icônes thumbsUp/thumbsDown)
- Modify: `src/components/brain/BrainChat.tsx` (rendu sous chaque réponse avec messageId)
- Test: `tests/components/FeedbackButtons.test.tsx`
- Modify: `tests/components/BrainChat.test.tsx` (mock trpc + test de présence)

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `tests/components/FeedbackButtons.test.tsx` :

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const { feedbackMutate } = vi.hoisted(() => ({ feedbackMutate: vi.fn() }))

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    brain: {
      feedback: {
        useMutation: () => ({ mutate: feedbackMutate, isPending: false }),
      },
    },
  },
}))

import { FeedbackButtons } from '@/components/brain/FeedbackButtons'

beforeEach(() => {
  feedbackMutate.mockClear()
})

test('clic 👍 → mutation like ; clic 👎 ensuite → mutation dislike (écrase)', () => {
  render(<FeedbackButtons messageId="msg-7" />)

  fireEvent.click(screen.getByRole('button', { name: /réponse utile/i }))
  expect(feedbackMutate).toHaveBeenCalledWith({ messageId: 'msg-7', feedback: 'like' })

  fireEvent.click(screen.getByRole('button', { name: /réponse inutile/i }))
  expect(feedbackMutate).toHaveBeenCalledWith({ messageId: 'msg-7', feedback: 'dislike' })
})

test('le bouton sélectionné est marqué aria-pressed', () => {
  render(<FeedbackButtons messageId="msg-7" />)
  const like = screen.getByRole('button', { name: /réponse utile/i })
  expect(like).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(like)
  expect(like).toHaveAttribute('aria-pressed', 'true')
})
```

Et dans `tests/components/BrainChat.test.tsx`, ajouter le mock trpc en tête (après les mocks existants) :

```tsx
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    brain: {
      feedback: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}))
```

Puis le test :

```tsx
test('les boutons feedback ne sont rendus que pour les réponses avec messageId', () => {
  mockChat([
    { role: 'user', text: 'q1' },
    { role: 'ai', text: 'r1', messageId: 'msg-7' },
    { role: 'user', text: 'q2' },
    { role: 'ai', text: 'r2' }, // pas de messageId (stream interrompu)
  ])

  render(<BrainChat suggestions={[]} />)

  expect(screen.getAllByRole('button', { name: /réponse utile/i })).toHaveLength(1)
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm vitest run tests/components/FeedbackButtons.test.tsx tests/components/BrainChat.test.tsx`
Expected: FAIL — composant inexistant, aucun bouton rendu.

- [ ] **Step 3 : Ajouter les icônes**

Dans `src/components/ui/Icon.tsx` : ajouter `ThumbsUp, ThumbsDown` à l'import lucide-react et au registre :

```ts
  thumbsUp: ThumbsUp,
  thumbsDown: ThumbsDown,
```

- [ ] **Step 4 : Implémenter le composant**

Créer `src/components/brain/FeedbackButtons.tsx` :

```tsx
'use client'

import { useState } from 'react'

import { Icon } from '@/components/ui/Icon'
import { trpc } from '@/lib/trpc/client'

type Feedback = 'like' | 'dislike'

/**
 * Discreet 👍/👎 under a finished BRAIN answer. Optimistic local state (kept
 * for the session only — not re-hydrated on reload); clicking the other
 * button overwrites the previous feedback.
 */
export function FeedbackButtons({ messageId }: { messageId: string }) {
  const [selected, setSelected] = useState<Feedback | null>(null)
  const feedback = trpc.brain.feedback.useMutation()

  const send = (value: Feedback) => {
    if (feedback.isPending || selected === value) return
    setSelected(value)
    feedback.mutate({ messageId, feedback: value })
  }

  const btn = (value: Feedback, icon: string, label: string) => {
    const active = selected === value
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={() => send(value)}
        className={`rounded-md p-1.5 transition-colors ${
          active ? 'text-red' : 'text-faint hover:text-sub'
        }`}
      >
        <Icon name={icon} size={15} />
      </button>
    )
  }

  return (
    <div className="mt-2 flex items-center gap-1">
      {btn('like', 'thumbsUp', 'Réponse utile')}
      {btn('dislike', 'thumbsDown', 'Réponse inutile')}
    </div>
  )
}
```

- [ ] **Step 5 : Intégrer dans `BrainChat`**

Dans `src/components/brain/BrainChat.tsx`, importer le composant :

```tsx
import { FeedbackButtons } from '@/components/brain/FeedbackButtons'
```

Dans `AiMessage`, juste après le `</div>` du bloc markdown (avant le bloc sources) :

```tsx
      {message.messageId && <FeedbackButtons messageId={message.messageId} />}
```

- [ ] **Step 6 : Vérifier le passage + suite**

Run: `pnpm vitest run tests/components/FeedbackButtons.test.tsx tests/components/BrainChat.test.tsx` puis `pnpm test`
Expected: PASS.

- [ ] **Step 7 : Commit**

```bash
git add src/components/brain/FeedbackButtons.tsx src/components/brain/BrainChat.tsx src/components/ui/Icon.tsx tests/components/FeedbackButtons.test.tsx tests/components/BrainChat.test.tsx
git commit -m "feat(brain): thumbs up/down feedback buttons under answers"
```

---

### Task 9 : Lib pure FAQ-gaps (normalisation, regroupement, CSV)

**Files:**
- Create: `src/lib/admin/faq-gaps.ts`
- Test: `tests/lib/faq-gaps.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `tests/lib/faq-gaps.test.ts` :

```ts
import { expect, test } from 'vitest'

import { normalizeQuestion, groupFaqGaps, buildFaqGapsCsv, type FaqGapRow } from '@/lib/admin/faq-gaps'

test('normalizeQuestion : casse, espaces, ponctuation finale ; accents conservés', () => {
  expect(normalizeQuestion('  Comment  paramétrer une caisse Mercalys ?? ')).toBe(
    'comment paramétrer une caisse mercalys',
  )
  expect(normalizeQuestion('Étapes de clôture…')).toBe('étapes de clôture')
})

const row = (over: Partial<FaqGapRow>): FaqGapRow => ({
  query: 'q',
  createdAt: new Date('2026-06-01T10:00:00Z'),
  retrievalScoreMax: null,
  retrievalCount: 0,
  feedback: null,
  ...over,
})

test('groupFaqGaps : regroupe par question normalisée, agrégats corrects', () => {
  const rows = [
    row({ query: 'Caisse Mercalys ?', createdAt: new Date('2026-06-03T10:00:00Z'), retrievalScoreMax: 0.4, retrievalCount: 2 }),
    row({ query: 'caisse mercalys', createdAt: new Date('2026-06-01T10:00:00Z'), retrievalScoreMax: 0.2, retrievalCount: 1, feedback: 'dislike' }),
    row({ query: 'Clôture comptable ?', createdAt: new Date('2026-06-02T10:00:00Z') }),
  ]

  const groups = groupFaqGaps(rows)

  expect(groups).toHaveLength(2)
  // Tri par fréquence desc : le groupe Mercalys (2 occurrences) d'abord.
  expect(groups[0]).toEqual({
    question: 'Caisse Mercalys ?', // exemplaire le plus récent
    count: 2,
    lastAskedAt: new Date('2026-06-03T10:00:00Z'),
    scoreMax: 0.4, // max du groupe
    retrievalCount: 2, // de la dernière occurrence
    dislikes: 1,
  })
  expect(groups[1].question).toBe('Clôture comptable ?')
  expect(groups[1].scoreMax).toBeNull()
})

test('groupFaqGaps : à fréquence égale, le plus récent en premier', () => {
  const groups = groupFaqGaps([
    row({ query: 'ancienne', createdAt: new Date('2026-06-01T10:00:00Z') }),
    row({ query: 'récente', createdAt: new Date('2026-06-04T10:00:00Z') }),
  ])
  expect(groups.map((g) => g.question)).toEqual(['récente', 'ancienne'])
})

test('buildFaqGapsCsv : BOM + en-tête + lignes ; score vide si null', () => {
  const csv = buildFaqGapsCsv([
    { question: 'Caisse ?', count: 2, lastAskedAt: new Date('2026-06-03T10:00:00Z'), scoreMax: 0.4, retrievalCount: 2, dislikes: 1 },
    { question: 'Clôture ?', count: 1, lastAskedAt: new Date('2026-06-02T10:00:00Z'), scoreMax: null, retrievalCount: 0, dislikes: 0 },
  ])

  const lines = csv.split('\n')
  expect(lines[0].endsWith('question;occurrences;derniere_date;score_max;nb_sources;dislikes')).toBe(true)
  expect(lines[1]).toBe('Caisse ?;2;2026-06-03;0.40;2;1')
  expect(lines[2]).toBe('Clôture ?;1;2026-06-02;;0;0')
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm vitest run tests/lib/faq-gaps.test.ts`
Expected: FAIL — module inexistant.

- [ ] **Step 3 : Implémenter**

Créer `src/lib/admin/faq-gaps.ts` :

```ts
/**
 * Pure helpers for the /admin/faq-gaps view: question normalization, grouping
 * with aggregates, and CSV export. No I/O — the admin router feeds rows in.
 */

import { BOM } from '@/lib/admin/csv-export'

export type FaqGapRow = {
  query: string
  createdAt: Date
  retrievalScoreMax: number | null
  retrievalCount: number
  feedback: string | null
}

export type FaqGapGroup = {
  /** Raw text of the most recent occurrence. */
  question: string
  count: number
  lastAskedAt: Date
  /** Max score across the group; null when no occurrence had sources. */
  scoreMax: number | null
  /** Source count of the most recent occurrence. */
  retrievalCount: number
  dislikes: number
}

/** lowercase, collapse whitespace, strip trailing punctuation; keep accents. */
export function normalizeQuestion(query: string): string {
  return query
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?!.…\s]+$/, '')
}

/** Groups rows by normalized question; sorted by count desc, then recency. */
export function groupFaqGaps(rows: FaqGapRow[]): FaqGapGroup[] {
  const byKey = new Map<string, FaqGapGroup>()

  for (const r of rows) {
    const key = normalizeQuestion(r.query)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, {
        question: r.query,
        count: 1,
        lastAskedAt: r.createdAt,
        scoreMax: r.retrievalScoreMax,
        retrievalCount: r.retrievalCount,
        dislikes: r.feedback === 'dislike' ? 1 : 0,
      })
      continue
    }
    existing.count += 1
    if (r.feedback === 'dislike') existing.dislikes += 1
    if (r.retrievalScoreMax !== null) {
      existing.scoreMax =
        existing.scoreMax === null ? r.retrievalScoreMax : Math.max(existing.scoreMax, r.retrievalScoreMax)
    }
    if (r.createdAt > existing.lastAskedAt) {
      existing.lastAskedAt = r.createdAt
      existing.question = r.query
      existing.retrievalCount = r.retrievalCount
    }
  }

  return [...byKey.values()].sort(
    (a, b) => b.count - a.count || b.lastAskedAt.getTime() - a.lastAskedAt.getTime(),
  )
}

/** `;`-delimited CSV with BOM (Excel-friendly), same contract as csv-export. */
export function buildFaqGapsCsv(groups: FaqGapGroup[]): string {
  const lines = ['question;occurrences;derniere_date;score_max;nb_sources;dislikes']
  for (const g of groups) {
    const date = g.lastAskedAt.toISOString().slice(0, 10)
    const score = g.scoreMax === null ? '' : g.scoreMax.toFixed(2)
    // Le séparateur `;` dans une question est remplacé pour ne pas casser les colonnes.
    const question = g.question.replace(/;/g, ',')
    lines.push(`${question};${g.count};${date};${score};${g.retrievalCount};${g.dislikes}`)
  }
  return BOM + lines.join('\n')
}
```

- [ ] **Step 4 : Vérifier le passage**

Run: `pnpm vitest run tests/lib/faq-gaps.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/admin/faq-gaps.ts tests/lib/faq-gaps.test.ts
git commit -m "feat(admin): pure FAQ-gaps grouping and CSV helpers"
```

---

### Task 10 : Router admin `faqGaps.list`

**Files:**
- Create: `src/server/trpc/routers/admin-faq-gaps.ts` (nouveau domaine = nouveau fichier — `admin.ts` fait déjà ~470 lignes, follow-up Phase 2 acté)
- Modify: `src/server/trpc/routers/admin.ts` (montage)
- Test: `tests/server/admin-faq-gaps.test.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `tests/server/admin-faq-gaps.test.ts` :

```ts
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const selectOrderBy = vi.fn()
const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }))
const selectFrom = vi.fn(() => ({ where: selectWhere }))
const dbSelect = vi.fn(() => ({ from: selectFrom }))
const dbMock = { select: dbSelect } as never

import { faqGapsRouter } from '@/server/trpc/routers/admin-faq-gaps'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(faqGapsRouter)

function caller(role: 'admin' | 'employee' = 'admin') {
  return createCaller({
    session: {
      user: { id: 'u1', role, storeId: null, firstName: 'Admin', email: 'a@b.fr' },
      expires: '',
    },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  selectOrderBy.mockResolvedValue([])
})

test('non-admin → FORBIDDEN', async () => {
  await expect(caller('employee').list()).rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('regroupe les lignes retournées par la DB', async () => {
  selectOrderBy.mockResolvedValue([
    {
      query: 'Caisse Mercalys ?',
      createdAt: new Date('2026-06-03T10:00:00Z'),
      retrievalScoreMax: 0.4,
      retrievalCount: 2,
      feedback: null,
    },
    {
      query: 'caisse mercalys',
      createdAt: new Date('2026-06-01T10:00:00Z'),
      retrievalScoreMax: null,
      retrievalCount: 0,
      feedback: 'dislike',
    },
  ])

  const groups = await caller().list()

  expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({ question: 'Caisse Mercalys ?', count: 2, dislikes: 1 })
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm vitest run tests/server/admin-faq-gaps.test.ts`
Expected: FAIL — module inexistant.

- [ ] **Step 3 : Implémenter**

Créer `src/server/trpc/routers/admin-faq-gaps.ts` :

```ts
import { and, desc, eq, gte, or } from 'drizzle-orm'

import { chatQueries } from '@/server/db/schema'
import { groupFaqGaps } from '@/lib/admin/faq-gaps'
import { adminProcedure, router } from '../trpc'

const WINDOW_DAYS = 30

/**
 * FAQ-gaps analysis: BRAIN questions from the last 30 days that had no
 * relevant source OR were disliked, grouped by normalized question text.
 */
export const faqGapsRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const rows = await ctx.db
      .select({
        query: chatQueries.query,
        createdAt: chatQueries.createdAt,
        retrievalScoreMax: chatQueries.retrievalScoreMax,
        retrievalCount: chatQueries.retrievalCount,
        feedback: chatQueries.feedback,
      })
      .from(chatQueries)
      .where(
        and(
          gte(chatQueries.createdAt, since),
          or(eq(chatQueries.hasRelevantSource, false), eq(chatQueries.feedback, 'dislike')),
        ),
      )
      .orderBy(desc(chatQueries.createdAt))

    return groupFaqGaps(rows)
  }),
})
```

Et dans `src/server/trpc/routers/admin.ts` : importer et monter le sous-router dans l'`adminRouter` final :

```ts
import { faqGapsRouter } from './admin-faq-gaps'

export const adminRouter = router({
  stores: storesRouter,
  formations: formationsRouter,
  // ... existant inchangé
  faqGaps: faqGapsRouter,
})
```

- [ ] **Step 4 : Vérifier le passage + suite**

Run: `pnpm vitest run tests/server/admin-faq-gaps.test.ts` puis `pnpm test`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/server/trpc/routers/admin-faq-gaps.ts src/server/trpc/routers/admin.ts tests/server/admin-faq-gaps.test.ts
git commit -m "feat(admin): faqGaps.list query over the last 30 days"
```

---

### Task 11 : Page admin `/admin/faq-gaps` + nav + docs

**Files:**
- Create: `src/app/admin/faq-gaps/page.tsx`
- Create: `src/components/admin/FaqGapsAdmin.tsx`
- Modify: `src/components/admin/AdminNav.tsx` (entrée nav)
- Modify: `docs/DEPLOY.md` (variable env + purge RGPD)
- Test: `tests/components/FaqGapsAdmin.test.tsx`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `tests/components/FaqGapsAdmin.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

const { listQuery } = vi.hoisted(() => ({ listQuery: vi.fn() }))

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    admin: { faqGaps: { list: { useQuery: () => listQuery() } } },
  },
}))

import { FaqGapsAdmin } from '@/components/admin/FaqGapsAdmin'

test('liste les groupes avec leurs agrégats', () => {
  listQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: [
      {
        question: 'Caisse Mercalys ?',
        count: 3,
        lastAskedAt: new Date('2026-06-03T10:00:00Z'),
        scoreMax: 0.4,
        retrievalCount: 2,
        dislikes: 1,
      },
    ],
  })

  render(<FaqGapsAdmin />)

  expect(screen.getByText('Caisse Mercalys ?')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByText('0.40')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /exporter/i })).toBeInTheDocument()
})

test('état vide explicite', () => {
  listQuery.mockReturnValue({ isLoading: false, isError: false, data: [] })
  render(<FaqGapsAdmin />)
  expect(screen.getByText(/aucun trou détecté/i)).toBeInTheDocument()
})
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `pnpm vitest run tests/components/FaqGapsAdmin.test.tsx`
Expected: FAIL — composant inexistant.

- [ ] **Step 3 : Implémenter le composant**

Créer `src/components/admin/FaqGapsAdmin.tsx` (mêmes constantes TH/TD que `SuggestionsAdmin`) :

```tsx
'use client'

import { trpc } from '@/lib/trpc/client'
import { buildFaqGapsCsv, type FaqGapGroup } from '@/lib/admin/faq-gaps'

const TH = 'px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide text-faint'
const TD = 'px-4 py-3 text-[14px] text-ink align-middle'

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('fr-FR')
}

export function FaqGapsAdmin() {
  const list = trpc.admin.faqGaps.list.useQuery()

  if (list.isLoading) {
    return <p className="mt-6 text-[14px] text-sub">Chargement…</p>
  }
  if (list.isError) {
    return <p className="mt-6 text-[14px] text-red">{list.error.message}</p>
  }

  const groups = (list.data ?? []) as FaqGapGroup[]

  const exportCsv = () => {
    const csv = buildFaqGapsCsv(
      groups.map((g) => ({ ...g, lastAskedAt: new Date(g.lastAskedAt) })),
    )
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `faq-gaps-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-sub">
          {groups.length} question{groups.length > 1 ? 's' : ''} groupée
          {groups.length > 1 ? 's' : ''} sur les 30 derniers jours
        </p>
        <button
          type="button"
          onClick={exportCsv}
          disabled={groups.length === 0}
          className="rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          Exporter CSV
        </button>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface">
              <th className={TH}>Question</th>
              <th className={TH}>Occurrences</th>
              <th className={TH}>Dernière date</th>
              <th className={TH}>Score max</th>
              <th className={TH}>Sources</th>
              <th className={TH}>👎</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td className={`${TD} text-sub`} colSpan={6}>
                  Aucun trou détecté sur les 30 derniers jours.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <tr key={g.question} className="border-b border-line last:border-0">
                <td className={`${TD} w-full`}>{g.question}</td>
                <td className={TD}>{g.count}</td>
                <td className={`${TD} whitespace-nowrap`}>{formatDate(g.lastAskedAt)}</td>
                <td className={TD}>{g.scoreMax === null ? '—' : g.scoreMax.toFixed(2)}</td>
                <td className={TD}>{g.retrievalCount}</td>
                <td className={TD}>{g.dislikes > 0 ? g.dislikes : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4 : Créer la page + l'entrée nav**

Créer `src/app/admin/faq-gaps/page.tsx` :

```tsx
import { FaqGapsAdmin } from '@/components/admin/FaqGapsAdmin'

export default function AdminFaqGapsPage() {
  return (
    <div>
      <h1 className="font-serif text-[30px] font-medium tracking-[-0.02em]">
        Trous de la FAQ
      </h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Questions BRAIN des 30 derniers jours sans source pertinente ou jugées
        inutiles — les candidates à enrichir dans la base documentaire.
      </p>
      <FaqGapsAdmin />
    </div>
  )
}
```

Dans `src/components/admin/AdminNav.tsx`, ajouter à `NAV_ITEMS` :

```ts
  ['/admin/faq-gaps', 'Trous FAQ', 'search'],
```

- [ ] **Step 5 : Documenter (DEPLOY.md)**

Dans `docs/DEPLOY.md`, ajouter à la liste des variables d'environnement :

```markdown
| `FAQ_RELEVANCE_THRESHOLD` | Seuil de pertinence (0..1) du log FAQ BRAIN. Défaut `0.5`. |
```

Et une section « Données & purge (RGPD) » :

```markdown
## Données & purge (RGPD)

La table `chat_queries` stocke les questions BRAIN (texte libre potentiellement
personnel) pour l'analyse FAQ. Conservation cible : **12 mois maximum**.
La purge n'est pas encore automatisée — exécuter périodiquement (ou planifier
en cron sur le VPS) :

```sql
DELETE FROM chat_queries WHERE created_at < now() - interval '12 months';
```
```

- [ ] **Step 6 : Vérifier le passage + suite + lint**

Run: `pnpm vitest run tests/components/FaqGapsAdmin.test.tsx` puis `pnpm test` puis `pnpm lint`
Expected: tout PASS, lint propre.

- [ ] **Step 7 : Commit**

```bash
git add src/app/admin/faq-gaps/ src/components/admin/FaqGapsAdmin.tsx src/components/admin/AdminNav.tsx docs/DEPLOY.md tests/components/FaqGapsAdmin.test.tsx
git commit -m "feat(admin): FAQ-gaps page with grouped questions and CSV export"
```

---

### Task 12 : Vérification finale

- [ ] **Step 1 : Suite complète + lint**

Run: `pnpm test` puis `pnpm lint`
Expected: tous les tests verts, lint propre.

- [ ] **Step 2 : Build de prod**

Run: `pnpm build`
Expected: build OK (vérifie le typage croisé tRPC/composants et la page admin).

- [ ] **Step 3 : Smoke test local (manuel, si Postgres dev dispo)**

- `pnpm dev`, poser une question sur `/brain` → vérifier en base : `SELECT query, retrieval_count, retrieval_score_max, has_relevant_source FROM chat_queries;`
- Cliquer 👎 → `SELECT feedback FROM chat_queries WHERE message_id = '...';` = `dislike`.
- Ouvrir `/admin/faq-gaps` en admin → la question apparaît si score < 0.5 ou dislike.

- [ ] **Step 4 : Push (Dokploy auto-déploie, migration au boot)**

```bash
git push origin main
```
