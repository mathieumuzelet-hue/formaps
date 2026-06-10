# BRAIN Robustness (PR ① audit 2026-06-09) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maîtriser le cycle de vie des appels Dify (timeout, abort, body) et fiabiliser la persistance du `conversationId` + le log FAQ-gaps — la classe de bug qui a causé les 2 incidents BRAIN de juin.

**Architecture:** Durcissement du proxy SSE `src/app/api/brain/route.ts` et du client `src/server/dify/client.ts` (signal/timeout), nouveau module pur `src/server/dify/heal.ts` (décision de purge), filtre FAQ-gaps recalculé à la lecture, 3 fixes client (FeedbackButtons, useBrainChat, BrainPage). Aucune migration.

**Tech Stack:** Next.js 16 route handler Node, undici fetch + AbortSignal, Drizzle, vitest (tests existants : `tests/server/brain-route.test.ts`, `tests/server/dify-feedback.test.ts`, `tests/lib/dify-parse.test.ts`, `tests/server/chat-log.test.ts`, `tests/server/admin-faq-gaps.test.ts`, `tests/components/FeedbackButtons.test.tsx`, `src/lib/brain/useBrainChat.test.ts`).

**Hors scope (autres PRs de la roadmap) :** errorFormatter tRPC, cron purge RGPD, timestamptz, CI, rate-limit.

**Décision d'architecture timeout (à respecter)** : le timeout couvre la phase **headers** uniquement (30 s). Un `AbortSignal.timeout` passé tel quel au fetch tuerait aussi les générations longues en plein stream — c'est pour ça qu'on arme un timer qu'on **clear dès que les headers arrivent**. La déconnexion client pendant le stream est déjà propagée par l'annulation du `pipeThrough` (vérifié à l'audit) ; le signal ne sert qu'avant le premier byte. Risque résiduel accepté : Dify qui envoie les headers puis se fige (couvert par aucun timeout — documenté).

---

### Task 0: Branche

- [ ] **Step 1:**
```bash
git -C C:\Users\mathi\formaps checkout -b feat/brain-robustness
```

---

### Task 1: `client.ts` — signal sur streamChat, timeout sur sendFeedback

**Files:**
- Modify: `src/server/dify/client.ts`
- Test: `tests/server/dify-feedback.test.ts` (existant — étendre) + nouveau cas dans le fichier de test qui couvre streamChat s'il existe (sinon ajouter dans dify-feedback.test.ts un describe streamChat ; LIRE les tests existants d'abord pour réutiliser leurs mocks de fetch/env)

- [ ] **Step 1: Failing tests.** Ajouter (en adaptant aux mocks existants du fichier — typiquement `vi.stubGlobal('fetch', …)` + env stubs) :

```ts
test('streamChat transmet le signal au fetch', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
  vi.stubGlobal('fetch', fetchMock)
  const controller = new AbortController()
  await streamChat({ query: 'q', user: 'u', signal: controller.signal })
  expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
})

test('sendFeedback est borné par un timeout (signal présent)', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await sendFeedback({ messageId: 'm1', rating: 'like', user: 'u' })
  expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
})
```

- [ ] **Step 2: Run** → FAIL (signal undefined).

- [ ] **Step 3: Implementation.** Dans `src/server/dify/client.ts` :
- `StreamChatArgs` gagne `signal?: AbortSignal` ; le fetch de `streamChat` reçoit `signal`.
- `sendFeedback` : ajouter au fetch `signal: AbortSignal.timeout(FEEDBACK_TIMEOUT_MS)` avec `const FEEDBACK_TIMEOUT_MS = 10_000` en tête de fichier (le relais feedback est best-effort : il ne doit jamais pendre la mutation tRPC).

- [ ] **Step 4: Run** tests du fichier + `npx vitest run tests/server/` → verts.
- [ ] **Step 5: Commit** `feat(dify): abort signal plumbing for streamChat, timeout for sendFeedback`

---

### Task 2: route — timeout de connexion + abort client sur la phase pré-stream

**Files:**
- Modify: `src/app/api/brain/route.ts` (le `callDify` lignes ~51-52)
- Test: `tests/server/brain-route.test.ts` (existant — LIRE d'abord : streamChat y est mocké via vi.mock, auth/db aussi)

- [ ] **Step 1: Failing test.** Ajouter au fichier de test (adapter aux mocks existants) :

```ts
test('passe un AbortSignal à streamChat (timeout connexion + abort client)', async () => {
  // arrange comme les autres tests du fichier (auth OK, stream minimal)
  await POST(makeRequest({ query: 'hello' }))
  const args = streamChat.mock.calls[0][0]
  expect(args.signal).toBeInstanceOf(AbortSignal)
})
```

- [ ] **Step 2: Run** → FAIL (args.signal undefined).

- [ ] **Step 3: Implementation.** Dans `route.ts`, remplacer le `callDify` par :

```ts
  const CONNECT_TIMEOUT_MS = 30_000

  // One controller per attempt: aborts the upstream fetch if the client is
  // already gone, or if Dify accepts the connection but never answers the
  // headers. The timer is cleared as soon as headers arrive so long
  // generations are never cut mid-stream (mid-stream client disconnects are
  // propagated by the pipeThrough cancellation, not by this signal).
  const callDify = async (convId: string | null): Promise<Response> => {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    request.signal.addEventListener('abort', onAbort)
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)
    try {
      return await streamChat({
        query,
        user: userId,
        conversationId: convId,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
      request.signal.removeEventListener('abort', onAbort)
    }
  }
```

Les deux sites d'appel (`callDify(conversationId)` et `callDify(null)`) restent inchangés ; leurs catch existants (502 `dify_unavailable`) couvrent l'AbortError/TimeoutError.

- [ ] **Step 4: Run** `npx vitest run tests/server/brain-route.test.ts` → verts (anciens inclus).
- [ ] **Step 5: Commit** `fix(brain): connect timeout + client-abort propagation on Dify calls`

---

### Task 3: auto-heal discriminé par code d'erreur + body consommé avant retry

Contexte : aujourd'hui N'IMPORTE QUEL 400 avec conversationId purge `difyConversationId` (perte du contexte utilisateur pour une simple `invalid_param`), et la première Response est abandonnée sans consommer son body (socket undici retenu).

**Files:**
- Create: `src/server/dify/heal.ts`
- Modify: `src/app/api/brain/route.ts` (bloc auto-heal lignes ~71-89)
- Test: `tests/server/dify-heal.test.ts` (nouveau) + cas route dans `tests/server/brain-route.test.ts`

- [ ] **Step 1: Failing tests.** Nouveau `tests/server/dify-heal.test.ts` :

```ts
import { describe, expect, test } from 'vitest'
import { shouldResetConversation } from '@/server/dify/heal'

describe('shouldResetConversation', () => {
  test('404 → reset (Conversation Not Exists)', () => {
    expect(shouldResetConversation(404, '{"code":"not_found"}')).toBe(true)
  })
  test('400 code conversation-agnostique → PAS de reset', () => {
    for (const code of ['invalid_param', 'app_unavailable', 'provider_not_initialize', 'provider_quota_exceeded']) {
      expect(shouldResetConversation(400, JSON.stringify({ code }))).toBe(false)
    }
  })
  test('400 autre code → reset (comportement historique conservé)', () => {
    expect(shouldResetConversation(400, '{"code":"model_currently_not_support"}')).toBe(true)
  })
  test('400 body non-JSON → reset par défaut', () => {
    expect(shouldResetConversation(400, '<html>oops</html>')).toBe(true)
  })
  test('autres statuts → jamais de reset', () => {
    expect(shouldResetConversation(500, '{}')).toBe(false)
  })
})
```

Et dans `brain-route.test.ts`, un cas : upstream 400 `{"code":"invalid_param"}` avec conversationId existant → la route répond 502 SANS update `difyConversationId` à null et SANS second appel streamChat (adapter aux mocks db du fichier).

- [ ] **Step 2: Run** → FAIL (module absent ; route purge encore).

- [ ] **Step 3: Implementation.**

`src/server/dify/heal.ts` :
```ts
/**
 * Decides whether a non-ok Dify response on an EXISTING conversation should
 * trigger the auto-heal (reset stored conversation id + retry once).
 *
 * Dify returns 400 for many causes unrelated to the conversation (bad input,
 * app misconfiguration, provider quota): resetting in those cases destroys
 * the user's conversation context for nothing. We keep the historical
 * heal-by-default for everything else (404 Conversation Not Exists, 400
 * model-pinned-to-conversation, unparseable bodies).
 */
const NON_CONVERSATION_CODES = new Set([
  'invalid_param',
  'app_unavailable',
  'provider_not_initialize',
  'provider_quota_exceeded',
])

export function shouldResetConversation(status: number, bodyText: string): boolean {
  if (status === 404) return true
  if (status !== 400) return false
  try {
    const parsed = JSON.parse(bodyText) as { code?: unknown }
    if (typeof parsed.code === 'string' && NON_CONVERSATION_CODES.has(parsed.code)) {
      return false
    }
  } catch {
    // Unparseable body: keep the heal-by-default behaviour.
  }
  return true
}
```

Dans `route.ts`, le bloc auto-heal devient (import `shouldResetConversation`) :
```ts
  if (!upstream.ok && (upstream.status === 400 || upstream.status === 404) && conversationId) {
    // Consume the body: releases the undici socket AND lets us discriminate
    // the Dify error code before destroying the user's conversation context.
    let bodyText = ''
    try {
      bodyText = await upstream.text()
    } catch {
      /* ignore */
    }
    if (!shouldResetConversation(upstream.status, bodyText)) {
      console.error(`[brain] Dify ${upstream.status} non lié à la conversation: ${bodyText.slice(0, 500)}`)
      return json({ error: 'dify_unavailable', status: upstream.status }, 502)
    }
    console.warn(
      `[brain] ${upstream.status} sur conversation existante → reset conversation + retry`,
    )
    // … (purge + retry existants, inchangés)
  }
```
Le commentaire d'en-tête du bloc (lignes ~62-70) doit être ajusté pour mentionner la discrimination par code.

- [ ] **Step 4: Run** `npx vitest run tests/server/` → verts.
- [ ] **Step 5: Commit** `fix(brain): discriminate Dify error codes before auto-heal, consume abandoned body`

---

### Task 4: persistance du conversationId au message_end + write-once

Contexte : l'id est persisté dès le PREMIER delta `message` (fire-and-forget) ; si un `event: error` suit, la purge n'est pas ordonnée face au `set(newId)` → id empoisonné possible. Et deux onglets simultanés sans conversation s'écrasent (last-write-wins).

**Files:**
- Modify: `src/app/api/brain/route.ts` (`inspectFrames`, lignes ~136-146)
- Test: `tests/server/brain-route.test.ts` (les tests existants qui assertent la persistance au premier `message` devront être DÉPLACÉS vers message_end — c'est un changement de comportement voulu)

- [ ] **Step 1: Failing tests.** Dans `brain-route.test.ts` :
  - cas A : stream `message` (avec conversation_id) PUIS `event: error` → AUCUN update `difyConversationId=newId` (seule la purge à null a lieu).
  - cas B : stream `message` + `message_end` → l'update `set({difyConversationId})` a lieu avec un `where` qui contient la condition write-once (vérifier que `isNull(users.difyConversationId)` est dans la clause — selon le mock db du fichier, asserter sur les arguments du mock).
  - Ajuster les tests existants si besoin (persistance désormais au message_end).

- [ ] **Step 2: Run** → FAIL (persist au premier delta).

- [ ] **Step 3: Implementation.** Dans `inspectFrames`, remplacer le bloc `if (parsed.conversationId) { … }` par :

```ts
      if (parsed.conversationId) {
        streamConversationId = parsed.conversationId
      }
      // Persist ONLY at message_end (success): persisting on the first delta
      // raced the in-stream error purge (the two fire-and-forget UPDATEs are
      // unordered) and could store a poisoned conversation id.
      if (
        parsed.messageId &&
        !hadConversationId &&
        !capturedConversationId &&
        !errorSeen &&
        streamConversationId
      ) {
        capturedConversationId = true
        const newId = streamConversationId
        void Promise.resolve(
          db
            .update(users)
            .set({ difyConversationId: newId })
            // Write-once: two parallel sends both starting without a stored
            // conversation would otherwise overwrite each other (last write
            // wins, orphaning one Dify conversation). First message_end wins.
            .where(and(eq(users.id, userId), isNull(users.difyConversationId))),
        ).catch(() => {})
      }
```

Imports drizzle : `import { and, eq, isNull } from 'drizzle-orm'`. (`parsed.messageId` n'est posé que par `message_end` — voir parse.ts.)

- [ ] **Step 4: Run** → verts.
- [ ] **Step 5: Commit** `fix(brain): persist conversation id at message_end only, write-once`

---

### Task 5: parsing SSE — `data:` avec espace optionnel

**Files:**
- Modify: `src/lib/dify/parse.ts` (`parseSSELines`, lignes ~123-132)
- Test: `tests/lib/dify-parse.test.ts` (existant — étendre)

- [ ] **Step 1: Failing test.**
```ts
test('parseSSELines accepte data: sans espace (spec SSE)', () => {
  expect(parseSSELines('data:{"event":"message"}')).toEqual(['{"event":"message"}'])
})
test('parseSSELines retire un seul espace optionnel', () => {
  expect(parseSSELines('data:  spaced')).toEqual([' spaced'])
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implementation.** Dans `parseSSELines` :
```ts
    if (trimmed.startsWith('data:')) {
      // SSE spec: the field value starts after 'data:' plus ONE optional space.
      payloads.push(trimmed.slice(5).replace(/^ /, ''))
    }
```

- [ ] **Step 4: Run** `npx vitest run tests/lib/dify-parse.test.ts` puis `npx vitest run tests/lib/ tests/server/ tests/components/` (le helper est partagé serveur/client) → verts.
- [ ] **Step 5: Commit** `fix(dify): accept SSE data: lines without a space per spec`

---

### Task 6: flush() — errorSeen exclu du log, scores par défaut, onConflictDoNothing, query bornée

**Files:**
- Modify: `src/app/api/brain/route.ts` (validation body lignes ~26-35 et `flush()` lignes ~166-191)
- Test: `tests/server/brain-route.test.ts`

- [ ] **Step 1: Failing tests.**
  - cas A : stream avec `event: error` puis `message_end` complet → AUCUN insert chat_queries (les conversations en erreur ne sont pas des FAQ-gaps).
  - cas B : `message_end` sans `metadata` exploitable (endScores null) mais avec messageId+conversationId → l'insert A LIEU avec `retrievalCount: 0` et `hasRelevantSource: false` (c'est précisément le signal FAQ-gap le plus intéressant).
  - cas C : POST avec `query` de 2001 caractères → 400 `{ error: 'query_too_long' }`, streamChat JAMAIS appelé.

- [ ] **Step 2: Run** → FAIL (A : insert a lieu ; B : early-return sur endScores===null ; C : 200).

- [ ] **Step 3: Implementation.**

Validation body (après le check existant) :
```ts
  const MAX_QUERY_LENGTH = 2000
  // …dans le try existant, après le check string/trim :
  if (body.query.length > MAX_QUERY_LENGTH) {
    return json({ error: 'query_too_long' }, 400)
  }
```
(Déclarer `MAX_QUERY_LENGTH` au niveau module, à côté de `CONNECT_TIMEOUT_MS`.)

Dans `flush()`, remplacer la garde et l'insert :
```ts
        // Never log errored conversations as FAQ gaps, and only log streams
        // that reached message_end (network cuts are noise). A message_end
        // WITHOUT retrieval metadata is logged with zero scores — "no source
        // at all" is exactly the FAQ-gap signal the admin screen exists for.
        if (errorSeen || !endMessageId || !streamConversationId) return
        const values = buildChatQueryValues({
          query,
          answer,
          conversationId: streamConversationId,
          messageId: endMessageId,
          userId,
          scores: endScores ?? [],
          threshold: relevanceThreshold(process.env.FAQ_RELEVANCE_THRESHOLD),
        })
        // Fire-and-forget; duplicate message ids (replayed end frames) are
        // expected noise, not errors — swallow them at the SQL level.
        void Promise.resolve(
          db.insert(chatQueries).values(values).onConflictDoNothing(),
        ).catch((err) => {
          console.error('[brain] log chat_queries a échoué:', err)
        })
```

- [ ] **Step 4: Run** `npx vitest run tests/server/brain-route.test.ts tests/server/chat-log.test.ts` → verts.
- [ ] **Step 5: Commit** `fix(brain): exclude errored streams from FAQ log, default scores, bounded query`

---

### Task 7: FAQ-gaps — seuil appliqué à la lecture

Contexte : `hasRelevantSource` est figé au seuil du moment de l'INSERT ; changer `FAQ_RELEVANCE_THRESHOLD` n'est pas rétroactif alors que `retrievalScoreMax` est stocké.

**Files:**
- Modify: `src/server/trpc/routers/admin-faq-gaps.ts`
- Test: `tests/server/admin-faq-gaps.test.ts` (existant — LIRE d'abord, adapter)

- [ ] **Step 1: Failing test.** Cas : une ligne avec `retrievalScoreMax: 0.6`, `hasRelevantSource: true` (insérée quand le seuil était 0.5) doit APPARAÎTRE dans la liste quand `FAQ_RELEVANCE_THRESHOLD=0.7` (stub env via `vi.stubEnv`). Et une ligne `retrievalScoreMax: 0.8` ne doit pas apparaître. (Selon la façon dont le test mocke ctx.db, asserter sur la clause where construite OU sur le résultat — suivre le style du fichier.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implementation.**
```ts
import { and, desc, eq, gte, isNull, lt, or } from 'drizzle-orm'
import { relevanceThreshold } from '@/server/brain/chat-log'
// …
    // Threshold applied at READ time so changing FAQ_RELEVANCE_THRESHOLD is
    // retroactive over the whole window (retrievalScoreMax is stored raw;
    // hasRelevantSource remains an insert-time cache, no longer queried here).
    const threshold = relevanceThreshold(process.env.FAQ_RELEVANCE_THRESHOLD)
    const rows = await ctx.db
      .select({ /* inchangé */ })
      .from(chatQueries)
      .where(
        and(
          gte(chatQueries.createdAt, since),
          or(
            isNull(chatQueries.retrievalScoreMax),
            lt(chatQueries.retrievalScoreMax, threshold),
            eq(chatQueries.feedback, 'dislike'),
          ),
        ),
      )
      .orderBy(desc(chatQueries.createdAt))
```

- [ ] **Step 4: Run** → verts.
- [ ] **Step 5: Commit** `fix(admin): FAQ-gaps threshold applied at read time (retroactive)`

---

### Task 8: fixes client — rollback feedback, erreur mi-stream annotée, suggestions résilientes

**Files:**
- Modify: `src/components/brain/FeedbackButtons.tsx`
- Modify: `src/lib/brain/useBrainChat.ts` (2 sites d'erreur : boucle ~149-151 et flush ~166-168)
- Modify: `src/app/(app)/brain/page.tsx`
- Test: `tests/components/FeedbackButtons.test.tsx` + `src/lib/brain/useBrainChat.test.ts` (existants — étendre)

- [ ] **Step 1: Failing tests.**

FeedbackButtons (adapter au mock trpc existant du fichier) :
```tsx
test("rollback de l'état optimiste si la mutation échoue", async () => {
  // mutate appelle options.onError
  mutateMock.mockImplementation((_input, opts) => opts?.onError?.(new Error('boom')))
  const user = userEvent.setup()
  render(<FeedbackButtons messageId="m1" />)
  await user.click(screen.getByRole('button', { name: 'Réponse utile' }))
  expect(screen.getByRole('button', { name: 'Réponse utile' })).toHaveAttribute('aria-pressed', 'false')
})
```

useBrainChat (suivre le style du fichier, qui simule des streams) : cas où le stream émet des deltas PUIS un `event: error` → le texte final du message AI contient les deltas ET le message d'erreur (séparés par `\n\n— `), pas seulement l'erreur.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implementation.**

FeedbackButtons — dans `send` :
```ts
  const send = (value: Feedback) => {
    if (feedback.isPending || selected === value) return
    const previous = selected
    setSelected(value)
    // Optimistic UI: roll back if the mutation fails so 👍 never lies.
    feedback.mutate(
      { messageId, feedback: value },
      { onError: () => setSelected(previous) },
    )
  }
```

useBrainChat — aux DEUX sites d'erreur in-stream (boucle et flush), remplacer
`updateAi((msg) => ({ ...msg, text }))` par :
```ts
            // Annotate instead of overwrite: keep whatever the model already
            // streamed (a mid-generation failure should not eat visible text).
            updateAi((msg) => ({ ...msg, text: msg.text ? `${msg.text}\n\n— ${text}` : text }))
```

BrainPage :
```tsx
export default async function BrainPage() {
  const api = await getServerCaller()
  // The fallback suggestions exist precisely for when the DB has none —
  // a failing query must not 500 the whole chat page.
  const rows = await api.brain.suggestions().catch(() => [])
  return <BrainChat suggestions={resolveSuggestions(rows.map((r) => r.text))} />
}
```

- [ ] **Step 4: Run** `npx vitest run tests/components/FeedbackButtons.test.tsx src/lib/brain/useBrainChat.test.ts` puis tests/components/ complet → verts.
- [ ] **Step 5: Commit** `fix(brain): optimistic feedback rollback, keep streamed text on error, resilient suggestions`

---

### Task 9: FAQ_RELEVANCE_THRESHOLD mappée dans compose + .env.example

Contexte (audit passe C) : la variable est documentée mais ABSENTE de `web.environment` dans docker-compose.yml — la poser dans l'UI Dokploy ne fait rien.

**Files:**
- Modify: `docker-compose.yml` (bloc `environment` du service web — LIRE le bloc pour matcher son style exact)
- Modify: `.env.example`

- [ ] **Step 1:** Ajouter au bloc environment du service web (style identique aux lignes voisines, défaut vide — `relevanceThreshold` retombe sur 0.5) : `FAQ_RELEVANCE_THRESHOLD: ${FAQ_RELEVANCE_THRESHOLD:-}`. Ajouter à `.env.example` (section runtime, avec un commentaire une ligne « seuil de pertinence FAQ-gaps, défaut 0.5 ») : `FAQ_RELEVANCE_THRESHOLD=`.
- [ ] **Step 2:** `docker compose config -q` (validation syntaxe — si docker absent sur la machine, vérifier le YAML par lecture attentive et le signaler).
- [ ] **Step 3: Commit** `fix(infra): map FAQ_RELEVANCE_THRESHOLD into the web container environment`

---

### Task 10: Vérification finale + PR

- [ ] **Step 1:** `npm test` (332 + nouveaux attendus verts), `npm run lint`, `npx tsc --noEmit` (2 erreurs préexistantes admises `tests/server/admin-users-password.test.ts:61`).
- [ ] **Step 2:** `git push -u origin feat/brain-robustness` puis `gh pr create` — titre `BRAIN robustness: Dify call lifecycle, conversation persistence, FAQ-gaps accuracy`, body résumant les 9 fixes + référence `docs/reviews/2026-06-09-fable5-audit.md`. NE PAS merger.
