# Pont APS → Dify Knowledge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un admin de pousser, en un clic et avec suivi d'état idempotent, les FAQ générées (→ dataset Q&A) et les PDF de formation (→ dataset documents) depuis le Cockpit vers les bases de connaissances Dify de BRAIN.

**Architecture:** Nouveau client Knowledge API Dify (`src/server/dify/knowledge.ts`) distinct de l'App API, clé dataset séparée. Une table-pont `dify_sync` (approche B) mappe `(sourceType, sourceId) → difyDocumentId + état`. Un router tRPC `difySync` (adminProcedure) orchestre push/unsync. UI = bouton + badge dans faq-builder et formations.

**Tech Stack:** Next.js (version modifiée — lire `node_modules/next/dist/docs/` avant tout code Next.js), TypeScript, tRPC, Drizzle (Postgres), zod, vitest, `node:crypto`/`node:fs`.

## Global Constraints

- Réponses/labels utilisateur en **français** ; code et commits en anglais.
- TDD strict : test rouge → impl minimale → vert → commit. Un commit par tâche.
- Branche : `feat/dify-knowledge-bridge` (base main `3ece616`, spec `62f471e`).
- Sens unique **APS → Dify** ; déclenchement **bouton uniquement** (jamais au save).
- **Clé dataset strictement séparée** de la clé App (`DIFY_API_KEY` inchangée).
- Ne JAMAIS s'appuyer sur `db push` : toute modif de `schema.ts` exige une migration générée (`pnpm db:generate`) dont le SQL est inspecté.
- Toute nouvelle env lue via `process.env` doit être **mappée dans le bloc `environment:` du service web du compose**, pas seulement posée dans Dokploy.
- Tout `fetch` vers Dify est borné par un timeout (jamais de hang de la mutation tRPC).
- Vérif pré-fini globale : `pnpm lint && pnpm typecheck && pnpm test` verts.
- Lancer un fichier de test ciblé : `npx vitest run <chemin>`.
- Endpoints Knowledge API utilisés ci-dessous = forme standard Dify. **Smoke test live obligatoire au déploiement** (Task 11) car ils varient selon la version de l'instance ; les tests unitaires utilisent un `fetch` factice et ne valident pas la version réelle.

---

## PHASE 1 — FAQ → dataset Q&A

### Task 1: Table `dify_sync` + enums + migration

**Files:**
- Modify: `src/server/db/schema.ts` (après les enums ligne 6-8, et en fin de fichier)
- Create: migration `drizzle/00XX_*.sql` (générée)
- Test: aucun (changement structurel — vérif par tsc + inspection SQL)

**Interfaces:**
- Produces: table `difySync` (Drizzle) + `difySourceTypeEnum`, `difySyncStatusEnum`. Colonnes : `id, sourceType, sourceId, datasetId, difyDocumentId, status, error, syncedAt, createdAt, updatedAt`. Unique `(sourceType, sourceId)`.

- [ ] **Step 1: Déclarer enums + table**

Dans `src/server/db/schema.ts`, après `newsStatusEnum` (ligne 8) :
```ts
export const difySourceTypeEnum = pgEnum('dify_source_type', ['faq_draft', 'formation_doc'])
export const difySyncStatusEnum = pgEnum('dify_sync_status', ['pending', 'synced', 'failed'])
```
En fin de fichier, ajouter la table :
```ts
/**
 * Pont APS → Dify : une ligne par contenu source poussé vers un dataset Dify.
 * sourceId est polymorphe (faqDrafts.id | formationDocuments.id) — pas de FK,
 * cohérence gérée applicativement (unsync au delete de la source).
 */
export const difySync = pgTable('dify_sync', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceType: difySourceTypeEnum('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  datasetId: text('dataset_id').notNull(),
  difyDocumentId: text('dify_document_id'),
  status: difySyncStatusEnum('status').notNull().default('pending'),
  error: text('error'),
  syncedAt: timestamp('synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  sourceUnique: uniqueIndex('dify_sync_source_unique').on(t.sourceType, t.sourceId),
}))
```

- [ ] **Step 2: Vérifier le typage**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Générer la migration**

Run: `pnpm db:generate`
Expected: nouveau `drizzle/00XX_*.sql` créé (CREATE TYPE x2 + CREATE TABLE + unique index).

- [ ] **Step 4: Inspecter le SQL**

Ouvrir le `.sql` généré : vérifier la création des deux types enum, de la table `dify_sync`, et de l'index unique `dify_sync_source_unique`. Aucune table existante n'est altérée → pas de clause `USING` à corriger.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(db): dify_sync bridge table + source/status enums"
```

---

### Task 2: Mapping pur `faqItemsToSegments` (Q&A)

**Files:**
- Create: `src/lib/dify/faq-segments.ts`
- Test: `tests/lib/dify-faq-segments.test.ts`

**Interfaces:**
- Consumes: `FaqItem` depuis `@/lib/faq/types` (`{ id, question, answer, origin }`).
- Produces: `faqItemsToSegments(items: FaqItem[]): DifyQaSegment[]` où `DifyQaSegment = { content: string; answer: string }`. Consommé par le client (Task 3) et le router (Task 5).

- [ ] **Step 1: Écrire le test (échoue)**

`tests/lib/dify-faq-segments.test.ts` :
```ts
import { describe, expect, test } from 'vitest'
import { faqItemsToSegments } from '@/lib/dify/faq-segments'
import type { FaqItem } from '@/lib/faq/types'

const item = (q: string, a: string): FaqItem => ({
  id: '00000000-0000-0000-0000-000000000001',
  question: q,
  answer: a,
  origin: 'generated',
})

describe('faqItemsToSegments', () => {
  test('maps question→content and answer→answer', () => {
    expect(faqItemsToSegments([item('Q1 ?', 'R1.')])).toEqual([
      { content: 'Q1 ?', answer: 'R1.' },
    ])
  })
  test('preserves order and count', () => {
    const out = faqItemsToSegments([item('a', '1'), item('b', '2')])
    expect(out.map((s) => s.content)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/lib/dify-faq-segments.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

`src/lib/dify/faq-segments.ts` :
```ts
import type { FaqItem } from '@/lib/faq/types'

/** Un segment Q&A Dify : question dans `content`, réponse dans `answer`. */
export type DifyQaSegment = { content: string; answer: string }

/** Mappe les paires FAQ d'un draft vers des segments Q&A Dify (ordre préservé). */
export function faqItemsToSegments(items: FaqItem[]): DifyQaSegment[] {
  return items.map((it) => ({ content: it.question, answer: it.answer }))
}
```

- [ ] **Step 4: Lancer test, vérifier le vert**

Run: `npx vitest run tests/lib/dify-faq-segments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dify/faq-segments.ts tests/lib/dify-faq-segments.test.ts
git commit -m "feat(dify): pure faqItemsToSegments mapping for Q&A push"
```

---

### Task 3: Client Knowledge — config, erreur, Q&A (createQaDocument), delete

**Files:**
- Create: `src/server/dify/knowledge.ts`
- Test: `tests/server/dify-knowledge.test.ts`

**Interfaces:**
- Consumes: `DifyQaSegment` (Task 2).
- Produces (exports) :
  - `class DifyKnowledgeError extends Error { status: number; body: string }`
  - `knowledgeConfig(): { base: string; datasetKey: string }` (throw si env absente)
  - `createQaDocument(args: { datasetId: string; name: string; segments: DifyQaSegment[]; fetchImpl?: typeof fetch }): Promise<{ documentId: string }>`
  - `deleteDocument(args: { datasetId: string; documentId: string; fetchImpl?: typeof fetch }): Promise<void>`
  - constante `KNOWLEDGE_TIMEOUT_MS = 30_000`

- [ ] **Step 1: Écrire le test (échoue)**

`tests/server/dify-knowledge.test.ts` :
```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createQaDocument,
  deleteDocument,
  DifyKnowledgeError,
  knowledgeConfig,
} from '@/server/dify/knowledge'

beforeEach(() => {
  process.env.DIFY_API_URL = 'https://dify.example.com/v1'
  process.env.DIFY_DATASET_API_KEY = 'dataset-key'
})
afterEach(() => vi.restoreAllMocks())

describe('knowledgeConfig', () => {
  test('strips trailing /v1 and reads dataset key', () => {
    expect(knowledgeConfig()).toEqual({ base: 'https://dify.example.com', datasetKey: 'dataset-key' })
  })
  test('throws when key missing', () => {
    delete process.env.DIFY_DATASET_API_KEY
    expect(() => knowledgeConfig()).toThrow()
  })
})

describe('createQaDocument', () => {
  test('creates a document then posts Q&A segments, returns documentId', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/document/create-by-text')) {
        return new Response(JSON.stringify({ document: { id: 'doc-1' } }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }) as unknown as typeof fetch

    const out = await createQaDocument({
      datasetId: 'ds-1',
      name: 'faq.pdf',
      segments: [{ content: 'Q ?', answer: 'R.' }],
      fetchImpl,
    })
    expect(out).toEqual({ documentId: 'doc-1' })
    expect(calls[0].url).toBe('https://dify.example.com/v1/datasets/ds-1/document/create-by-text')
    expect(calls[1].url).toBe('https://dify.example.com/v1/datasets/ds-1/documents/doc-1/segments')
    const seg = JSON.parse(calls[1].init.body as string)
    expect(seg.segments).toEqual([{ content: 'Q ?', answer: 'R.' }])
    const auth = (calls[0].init.headers as Record<string, string>).Authorization
    expect(auth).toBe('Bearer dataset-key')
  })

  test('throws DifyKnowledgeError on non-ok', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    await expect(
      createQaDocument({ datasetId: 'ds', name: 'n', segments: [], fetchImpl }),
    ).rejects.toBeInstanceOf(DifyKnowledgeError)
  })
})

describe('deleteDocument', () => {
  test('DELETEs the document', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch
    await deleteDocument({ datasetId: 'ds', documentId: 'doc-9', fetchImpl })
    const url = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]
    expect(url).toBe('https://dify.example.com/v1/datasets/ds/documents/doc-9')
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/server/dify-knowledge.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le client**

`src/server/dify/knowledge.ts` :
```ts
/**
 * Server-only Dify KNOWLEDGE (dataset) API client. Distinct de l'App API
 * (client.ts) : clé dataset séparée. fetchImpl est injectable pour les tests.
 */
import type { DifyQaSegment } from '@/lib/dify/faq-segments'

export const KNOWLEDGE_TIMEOUT_MS = 30_000

export class DifyKnowledgeError extends Error {
  constructor(public status: number, public body: string) {
    super(`Dify knowledge API failed: ${status}`)
    this.name = 'DifyKnowledgeError'
  }
}

/** Resolves base URL (no trailing slash/v1) + dataset key. Throws if unset. */
export function knowledgeConfig(): { base: string; datasetKey: string } {
  const apiUrl = process.env.DIFY_API_URL
  const datasetKey = process.env.DIFY_DATASET_API_KEY
  if (!apiUrl || !datasetKey) {
    throw new Error('DIFY_API_URL and DIFY_DATASET_API_KEY must be set')
  }
  const base = apiUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
  return { base, datasetKey }
}

async function postJson(
  url: string,
  datasetKey: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: 'POST',
    signal: AbortSignal.timeout(KNOWLEDGE_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${datasetKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new DifyKnowledgeError(res.status, await res.text().catch(() => ''))
  return res.json().catch(() => ({}))
}

/**
 * Crée un document Q&A dans le dataset puis y ajoute les segments Q/R.
 * Le document est créé via create-by-text (texte placeholder minimal) en mode
 * Q&A, puis les paires exactes sont posées via l'API segments.
 */
export async function createQaDocument(args: {
  datasetId: string
  name: string
  segments: DifyQaSegment[]
  fetchImpl?: typeof fetch
}): Promise<{ documentId: string }> {
  const { datasetId, name, segments } = args
  const fetchImpl = args.fetchImpl ?? fetch
  const { base, datasetKey } = knowledgeConfig()

  const created = (await postJson(
    `${base}/v1/datasets/${datasetId}/document/create-by-text`,
    datasetKey,
    {
      name,
      text: name,
      indexing_technique: 'high_quality',
      doc_form: 'qa_model',
      process_rule: { mode: 'automatic' },
    },
    fetchImpl,
  )) as { document?: { id?: string } }
  const documentId = created.document?.id
  if (!documentId) throw new DifyKnowledgeError(200, 'create-by-text: missing document id')

  await postJson(
    `${base}/v1/datasets/${datasetId}/documents/${documentId}/segments`,
    datasetKey,
    { segments },
    fetchImpl,
  )
  return { documentId }
}

export async function deleteDocument(args: {
  datasetId: string
  documentId: string
  fetchImpl?: typeof fetch
}): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch
  const { base, datasetKey } = knowledgeConfig()
  const res = await fetchImpl(`${base}/v1/datasets/${args.datasetId}/documents/${args.documentId}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(KNOWLEDGE_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${datasetKey}` },
  })
  if (!res.ok) throw new DifyKnowledgeError(res.status, await res.text().catch(() => ''))
}
```

> Note d'implémentation : `doc_form: 'qa_model'` et le placeholder `text` sont la forme standard. Si le smoke test live (Task 11) révèle une sémantique différente (ex. segments rejetés sur un doc create-by-text), basculer sur la variante documentée par la version de l'instance. La structure (création → segments) reste identique.

- [ ] **Step 4: Lancer test, vérifier le vert**

Run: `npx vitest run tests/server/dify-knowledge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/dify/knowledge.ts tests/server/dify-knowledge.test.ts
git commit -m "feat(dify): knowledge API client — createQaDocument + deleteDocument (E-config separate key)"
```

---

### Task 4: Helper d'upsert `dify_sync` (server)

**Files:**
- Create: `src/server/dify/sync-store.ts`
- Test: `tests/server/dify-sync-store.test.ts`

**Interfaces:**
- Produces:
  - `upsertSync(db, args: { sourceType: 'faq_draft' | 'formation_doc'; sourceId: string; datasetId: string; difyDocumentId: string | null; status: 'pending' | 'synced' | 'failed'; error?: string | null }): Promise<void>` — insert-or-update sur la clé `(sourceType, sourceId)`, met `syncedAt` quand `status==='synced'`.
  - `getSyncRow(db, sourceType, sourceId): Promise<{ difyDocumentId: string | null; datasetId: string } | null>`

- [ ] **Step 1: Écrire le test (échoue)**

`tests/server/dify-sync-store.test.ts` — db factice chaînable, asserte les appels :
```ts
import { describe, expect, test, vi } from 'vitest'
import { upsertSync, getSyncRow } from '@/server/dify/sync-store'

function mockDb() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn(() => ({ onConflictDoUpdate }))
  const insert = vi.fn(() => ({ values }))
  const where = vi.fn().mockResolvedValue([{ difyDocumentId: 'd1', datasetId: 'ds' }])
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  return { db: { insert, select } as never, insert, values, onConflictDoUpdate, select, from, where }
}

describe('upsertSync', () => {
  test('inserts with synced status sets syncedAt and conflict-updates', async () => {
    const m = mockDb()
    await upsertSync(m.db, {
      sourceType: 'faq_draft', sourceId: 's1', datasetId: 'ds',
      difyDocumentId: 'doc1', status: 'synced',
    })
    expect(m.values).toHaveBeenCalledTimes(1)
    const row = m.values.mock.calls[0][0] as Record<string, unknown>
    expect(row.status).toBe('synced')
    expect(row.syncedAt).toBeInstanceOf(Date)
    expect(m.onConflictDoUpdate).toHaveBeenCalledTimes(1)
  })
  test('failed status carries error and null syncedAt', async () => {
    const m = mockDb()
    await upsertSync(m.db, {
      sourceType: 'faq_draft', sourceId: 's1', datasetId: 'ds',
      difyDocumentId: null, status: 'failed', error: 'boom',
    })
    const row = m.values.mock.calls[0][0] as Record<string, unknown>
    expect(row.status).toBe('failed')
    expect(row.error).toBe('boom')
    expect(row.syncedAt).toBeNull()
  })
})

describe('getSyncRow', () => {
  test('returns the row when present', async () => {
    const m = mockDb()
    expect(await getSyncRow(m.db, 'faq_draft', 's1')).toEqual({ difyDocumentId: 'd1', datasetId: 'ds' })
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/server/dify-sync-store.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

`src/server/dify/sync-store.ts` :
```ts
import { and, eq } from 'drizzle-orm'
import type { db as Db } from '@/server/db'
import { difySync } from '@/server/db/schema'

type DbLike = typeof Db
type SourceType = 'faq_draft' | 'formation_doc'
type Status = 'pending' | 'synced' | 'failed'

export async function upsertSync(
  db: DbLike,
  args: {
    sourceType: SourceType
    sourceId: string
    datasetId: string
    difyDocumentId: string | null
    status: Status
    error?: string | null
  },
): Promise<void> {
  const syncedAt = args.status === 'synced' ? new Date() : null
  const row = {
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    datasetId: args.datasetId,
    difyDocumentId: args.difyDocumentId,
    status: args.status,
    error: args.error ?? null,
    syncedAt,
    updatedAt: new Date(),
  }
  await db
    .insert(difySync)
    .values(row)
    .onConflictDoUpdate({ target: [difySync.sourceType, difySync.sourceId], set: row })
}

export async function getSyncRow(
  db: DbLike,
  sourceType: SourceType,
  sourceId: string,
): Promise<{ difyDocumentId: string | null; datasetId: string } | null> {
  const rows = await db
    .select({ difyDocumentId: difySync.difyDocumentId, datasetId: difySync.datasetId })
    .from(difySync)
    .where(and(eq(difySync.sourceType, sourceType), eq(difySync.sourceId, sourceId)))
  return rows[0] ?? null
}
```

- [ ] **Step 4: Lancer test, vérifier le vert**

Run: `npx vitest run tests/server/dify-sync-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/dify/sync-store.ts tests/server/dify-sync-store.test.ts
git commit -m "feat(dify): upsertSync/getSyncRow store helpers for dify_sync"
```

---

### Task 5: Router `difySync` — pushFaq + unsync + status

**Files:**
- Create: `src/server/trpc/routers/dify-sync.ts`
- Modify: `src/server/trpc/routers/admin.ts` (enregistrer `difySync`)
- Test: `tests/server/dify-sync-router.test.ts`

**Interfaces:**
- Consumes: `createQaDocument`, `deleteDocument` (Task 3) ; `faqItemsToSegments` (Task 2) ; `upsertSync`, `getSyncRow` (Task 4) ; `faqDrafts` (schema).
- Produces (procédures adminProcedure) :
  - `pushFaq({ draftId: string })` → `{ documentId: string }`
  - `unsync({ sourceType, sourceId })` → `{ ok: true }`
  - `status({ sourceType, sourceIds: string[] })` → `Array<{ sourceId, status, syncedAt, error }>`
- Résolution dataset : `DIFY_QA_DATASET_ID` pour `faq_draft`. Si env absente → `PRECONDITION_FAILED` (`dify_knowledge_not_configured`).

- [ ] **Step 1: Écrire le test (échoue)**

`tests/server/dify-sync-router.test.ts` — calque `admin-faq-builder.test.ts` (mock auth + db + modules) :
```ts
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const { createQaDocument, deleteDocument } = vi.hoisted(() => ({
  createQaDocument: vi.fn(),
  deleteDocument: vi.fn(),
}))
vi.mock('@/server/dify/knowledge', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createQaDocument,
  deleteDocument,
}))
const { upsertSync, getSyncRow } = vi.hoisted(() => ({ upsertSync: vi.fn(), getSyncRow: vi.fn() }))
vi.mock('@/server/dify/sync-store', () => ({ upsertSync, getSyncRow }))

const selectWhere = vi.fn()
const selectFrom = vi.fn(() => ({ where: selectWhere }))
const dbMock = { select: vi.fn(() => ({ from: selectFrom })) } as never

import { adminRouter } from '@/server/trpc/routers/admin'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(adminRouter)
const DRAFT_ID = '6f9619ff-8b86-4d01-b42d-00c04fc964ff'
function caller(role: 'admin' | 'employee' = 'admin') {
  return createCaller({
    session: { user: { id: 'a', role, storeId: null, firstName: 'A', email: 'a@b.fr' }, expires: '' },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.DIFY_QA_DATASET_ID = 'qa-ds'
  process.env.DIFY_API_URL = 'https://d/v1'
  process.env.DIFY_DATASET_API_KEY = 'k'
  getSyncRow.mockResolvedValue(null)
})

test('pushFaq pushes segments and upserts synced', async () => {
  selectWhere.mockResolvedValue([
    { id: DRAFT_ID, sourceFilename: 'faq.pdf', items: [{ id: 'i1', question: 'Q', answer: 'R', origin: 'generated' }] },
  ])
  createQaDocument.mockResolvedValue({ documentId: 'doc-1' })
  const out = await caller().difySync.pushFaq({ draftId: DRAFT_ID })
  expect(out).toEqual({ documentId: 'doc-1' })
  expect(createQaDocument).toHaveBeenCalledWith(
    expect.objectContaining({ datasetId: 'qa-ds', name: 'faq.pdf', segments: [{ content: 'Q', answer: 'R' }] }),
  )
  expect(upsertSync).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ sourceType: 'faq_draft', sourceId: DRAFT_ID, status: 'synced', difyDocumentId: 'doc-1' }),
  )
})

test('pushFaq re-push deletes the previous document first', async () => {
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, sourceFilename: 'f.pdf', items: [] }])
  getSyncRow.mockResolvedValue({ difyDocumentId: 'old-doc', datasetId: 'qa-ds' })
  createQaDocument.mockResolvedValue({ documentId: 'new-doc' })
  await caller().difySync.pushFaq({ draftId: DRAFT_ID })
  expect(deleteDocument).toHaveBeenCalledWith(expect.objectContaining({ datasetId: 'qa-ds', documentId: 'old-doc' }))
})

test('pushFaq on client failure upserts failed and rethrows', async () => {
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, sourceFilename: 'f.pdf', items: [] }])
  createQaDocument.mockRejectedValue(new Error('boom'))
  await expect(caller().difySync.pushFaq({ draftId: DRAFT_ID })).rejects.toThrow()
  expect(upsertSync).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ status: 'failed', error: expect.stringContaining('boom') }),
  )
})

test('pushFaq without DIFY_QA_DATASET_ID → PRECONDITION_FAILED', async () => {
  delete process.env.DIFY_QA_DATASET_ID
  await expect(caller().difySync.pushFaq({ draftId: DRAFT_ID })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
})

test('non-admin → FORBIDDEN', async () => {
  await expect(caller('employee').difySync.pushFaq({ draftId: DRAFT_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' })
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/server/dify-sync-router.test.ts`
Expected: FAIL — `difySync` non enregistré.

- [ ] **Step 3: Implémenter le router**

`src/server/trpc/routers/dify-sync.ts` :
```ts
import { TRPCError } from '@trpc/server'
import { eq, inArray, and } from 'drizzle-orm'
import { z } from 'zod'

import { faqDrafts, difySync } from '@/server/db/schema'
import { faqItemsToSegments } from '@/lib/dify/faq-segments'
import { createQaDocument, deleteDocument } from '@/server/dify/knowledge'
import { upsertSync, getSyncRow } from '@/server/dify/sync-store'
import { adminProcedure, router } from '../trpc'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'dify_knowledge_not_configured' })
  }
  return v
}

const sourceTypeSchema = z.enum(['faq_draft', 'formation_doc'])

export const difySyncRouter = router({
  pushFaq: adminProcedure
    .input(z.object({ draftId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const datasetId = requireEnv('DIFY_QA_DATASET_ID')
      const [draft] = await ctx.db
        .select({ id: faqDrafts.id, sourceFilename: faqDrafts.sourceFilename, items: faqDrafts.items })
        .from(faqDrafts)
        .where(eq(faqDrafts.id, input.draftId))
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND' })

      // Re-push : on supprime l'ancien document Dify avant de recréer (best-effort).
      const existing = await getSyncRow(ctx.db, 'faq_draft', input.draftId)
      if (existing?.difyDocumentId) {
        try {
          await deleteDocument({ datasetId: existing.datasetId, documentId: existing.difyDocumentId })
        } catch (err) {
          console.error('[dify-sync] delete ancien doc FAQ a échoué (on continue):', err)
        }
      }

      try {
        const { documentId } = await createQaDocument({
          datasetId,
          name: draft.sourceFilename,
          segments: faqItemsToSegments(draft.items),
        })
        await upsertSync(ctx.db, {
          sourceType: 'faq_draft', sourceId: input.draftId, datasetId,
          difyDocumentId: documentId, status: 'synced',
        })
        return { documentId }
      } catch (err) {
        await upsertSync(ctx.db, {
          sourceType: 'faq_draft', sourceId: input.draftId, datasetId,
          difyDocumentId: null, status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'dify_push_failed' })
      }
    }),

  unsync: adminProcedure
    .input(z.object({ sourceType: sourceTypeSchema, sourceId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getSyncRow(ctx.db, input.sourceType, input.sourceId)
      if (existing?.difyDocumentId) {
        try {
          await deleteDocument({ datasetId: existing.datasetId, documentId: existing.difyDocumentId })
        } catch (err) {
          console.error('[dify-sync] delete Dify a échoué (purge locale quand même):', err)
        }
      }
      await ctx.db
        .delete(difySync)
        .where(and(eq(difySync.sourceType, input.sourceType), eq(difySync.sourceId, input.sourceId)))
      return { ok: true as const }
    }),

  status: adminProcedure
    .input(z.object({ sourceType: sourceTypeSchema, sourceIds: z.array(z.uuid()).max(500) }))
    .query(async ({ ctx, input }) => {
      if (input.sourceIds.length === 0) return []
      return ctx.db
        .select({
          sourceId: difySync.sourceId,
          status: difySync.status,
          syncedAt: difySync.syncedAt,
          error: difySync.error,
        })
        .from(difySync)
        .where(and(eq(difySync.sourceType, input.sourceType), inArray(difySync.sourceId, input.sourceIds)))
    }),
})
```
Enregistrer dans `src/server/trpc/routers/admin.ts` : importer `difySyncRouter` et l'ajouter au `router({ ... })` sous la clé `difySync: difySyncRouter` (suivre la façon dont `faqBuilder` y est branché).

- [ ] **Step 4: Lancer test + tsc, vérifier le vert**

Run: `npx vitest run tests/server/dify-sync-router.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/dify-sync.ts src/server/trpc/routers/admin.ts tests/server/dify-sync-router.test.ts
git commit -m "feat(dify): difySync router — pushFaq/unsync/status (admin)"
```

---

### Task 6: UI — bouton « Pousser vers Dify » + badge (FAQ builder)

**Files:**
- Modify: `src/components/admin/FaqDraftEditor.tsx` (bouton + badge + appel mutation)
- Test: aucun test unitaire de composant (le repo n'en a pas pour cet écran) — vérification par tsc + lint ; le comportement serveur est couvert par Task 5.

**Interfaces:**
- Consomme la procédure tRPC `difySync.pushFaq` et `difySync.status` (Task 5) via le client tRPC utilisé ailleurs dans l'admin.

- [ ] **Step 1: Repérer le pattern client tRPC**

Lire `src/components/admin/FaqDraftEditor.tsx` pour voir comment les mutations tRPC existantes (ex. `updateItems`) sont appelées (hook client, gestion `pending`/erreur). Reproduire EXACTEMENT ce pattern.

- [ ] **Step 2: Ajouter le bouton + badge**

Ajouter, près des actions existantes du draft :
- un bouton « Pousser vers Dify » qui appelle `difySync.pushFaq({ draftId })` ;
- un état local (`pending`/`error`) + un badge lisant `difySync.status({ sourceType: 'faq_draft', sourceIds: [draftId] })` (synced/en attente/échec + date).
Libellés en français. Le bouton CSV existant reste inchangé (fallback).
Pattern d'état par ligne discriminé (pas de `pending` global) — cf. règle projet.

- [ ] **Step 3: Vérifier lint + tsc**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS (0 warning).

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/FaqDraftEditor.tsx
git commit -m "feat(admin): push-to-Dify button + sync badge on FAQ draft"
```

---

## PHASE 2 — PDF Formations → dataset documents

### Task 7: Extraire `uploads.ts` (chemin PDF formation) + refactor download route

**Files:**
- Create: `src/server/storage/uploads.ts`
- Modify: `src/app/api/documents/[docId]/download/route.ts:12-14,47` (consommer le helper)
- Test: `tests/server/uploads-path.test.ts`

**Interfaces:**
- Produces: `uploadsDir(): string` (`process.env.UPLOADS_DIR || '/app/uploads'`), `formationPdfPath(docId: string): string` (`<uploadsDir>/<docId>.pdf`).

- [ ] **Step 1: Écrire le test (échoue)**

`tests/server/uploads-path.test.ts` :
```ts
import { afterEach, describe, expect, test } from 'vitest'
import { uploadsDir, formationPdfPath } from '@/server/storage/uploads'

afterEach(() => { delete process.env.UPLOADS_DIR })

describe('uploads paths', () => {
  test('defaults to /app/uploads', () => {
    expect(uploadsDir()).toBe('/app/uploads')
  })
  test('honours UPLOADS_DIR env', () => {
    process.env.UPLOADS_DIR = '/data/up'
    expect(uploadsDir()).toBe('/data/up')
  })
  test('formationPdfPath joins docId.pdf', () => {
    process.env.UPLOADS_DIR = '/data/up'
    expect(formationPdfPath('abc')).toBe('/data/up/abc.pdf'.replace(/\//g, require('node:path').sep))
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/server/uploads-path.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter + refactor**

`src/server/storage/uploads.ts` :
```ts
import path from 'node:path'

/** Volume persistant des PDF de formation (même valeur que la route download). */
export function uploadsDir(): string {
  return process.env.UPLOADS_DIR || '/app/uploads'
}

/** Chemin disque du PDF d'un document de formation. */
export function formationPdfPath(docId: string): string {
  return path.join(uploadsDir(), `${docId}.pdf`)
}
```
Dans `src/app/api/documents/[docId]/download/route.ts` : supprimer la fonction locale `uploadsDir` (lignes 12-14), importer `formationPdfPath`, et remplacer ligne 47 par `const filePath = formationPdfPath(docId)`.

- [ ] **Step 4: Lancer test + suite download, vérifier le vert**

Run: `npx vitest run tests/server/uploads-path.test.ts tests/server/download-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/storage/uploads.ts "src/app/api/documents/[docId]/download/route.ts" tests/server/uploads-path.test.ts
git commit -m "refactor(storage): shared uploadsDir/formationPdfPath helper"
```

---

### Task 8: Client Knowledge — createDocumentByFile / updateDocumentByFile

**Files:**
- Modify: `src/server/dify/knowledge.ts`
- Test: `tests/server/dify-knowledge.test.ts` (étendre)

**Interfaces:**
- Produces:
  - `createDocumentByFile(args: { datasetId: string; name: string; bytes: Uint8Array; fetchImpl?: typeof fetch }): Promise<{ documentId: string }>`
  - `updateDocumentByFile(args: { datasetId: string; documentId: string; name: string; bytes: Uint8Array; fetchImpl?: typeof fetch }): Promise<void>`
- Multipart : champ `data` = JSON string (`{ name, indexing_technique:'high_quality', process_rule:{mode:'automatic'} }`), champ `file` = blob PDF.

- [ ] **Step 1: Écrire le test (échoue)**

Ajouter à `tests/server/dify-knowledge.test.ts` :
```ts
import { createDocumentByFile, updateDocumentByFile } from '@/server/dify/knowledge'

describe('createDocumentByFile', () => {
  test('posts multipart with data + file, returns documentId', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(JSON.stringify({ document: { id: 'doc-f' } }), { status: 200 })
    }) as unknown as typeof fetch
    const out = await createDocumentByFile({
      datasetId: 'ds', name: 'cours.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), fetchImpl,
    })
    expect(out).toEqual({ documentId: 'doc-f' })
    expect(captured!.url).toBe('https://dify.example.com/v1/datasets/ds/document/create-by-file')
    expect(captured!.init.body).toBeInstanceOf(FormData)
    const fd = captured!.init.body as FormData
    expect(JSON.parse(fd.get('data') as string).name).toBe('cours.pdf')
    expect(fd.get('file')).toBeInstanceOf(Blob)
    // pas de Content-Type manuel : FormData le pose lui-même (boundary)
    expect((captured!.init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/server/dify-knowledge.test.ts`
Expected: FAIL — fonctions absentes.

- [ ] **Step 3: Implémenter**

Ajouter à `src/server/dify/knowledge.ts` :
```ts
async function postFile(
  url: string,
  datasetKey: string,
  name: string,
  bytes: Uint8Array,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const fd = new FormData()
  fd.set('data', JSON.stringify({
    name,
    indexing_technique: 'high_quality',
    process_rule: { mode: 'automatic' },
  }))
  fd.set('file', new Blob([bytes], { type: 'application/pdf' }), name)
  const res = await fetchImpl(url, {
    method: 'POST',
    signal: AbortSignal.timeout(KNOWLEDGE_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${datasetKey}` }, // pas de Content-Type : FormData gère le boundary
    body: fd,
  })
  if (!res.ok) throw new DifyKnowledgeError(res.status, await res.text().catch(() => ''))
  return res.json().catch(() => ({}))
}

export async function createDocumentByFile(args: {
  datasetId: string; name: string; bytes: Uint8Array; fetchImpl?: typeof fetch
}): Promise<{ documentId: string }> {
  const fetchImpl = args.fetchImpl ?? fetch
  const { base, datasetKey } = knowledgeConfig()
  const out = (await postFile(
    `${base}/v1/datasets/${args.datasetId}/document/create-by-file`,
    datasetKey, args.name, args.bytes, fetchImpl,
  )) as { document?: { id?: string } }
  const documentId = out.document?.id
  if (!documentId) throw new DifyKnowledgeError(200, 'create-by-file: missing document id')
  return { documentId }
}

export async function updateDocumentByFile(args: {
  datasetId: string; documentId: string; name: string; bytes: Uint8Array; fetchImpl?: typeof fetch
}): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch
  const { base, datasetKey } = knowledgeConfig()
  await postFile(
    `${base}/v1/datasets/${args.datasetId}/documents/${args.documentId}/update-by-file`,
    datasetKey, args.name, args.bytes, fetchImpl,
  )
}
```

- [ ] **Step 4: Lancer test, vérifier le vert**

Run: `npx vitest run tests/server/dify-knowledge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/dify/knowledge.ts tests/server/dify-knowledge.test.ts
git commit -m "feat(dify): knowledge client — create/update document by file (PDF)"
```

---

### Task 9: Router `difySync.pushFormationDoc`

**Files:**
- Modify: `src/server/trpc/routers/dify-sync.ts`
- Test: `tests/server/dify-sync-router.test.ts` (étendre)

**Interfaces:**
- Consumes: `createDocumentByFile`/`updateDocumentByFile` (Task 8), `formationPdfPath` (Task 7), `formationDocuments` (schema), `upsertSync`/`getSyncRow` (Task 4).
- Produces: `pushFormationDoc({ docId: string })` → `{ documentId: string }`. Dataset = `DIFY_DOCS_DATASET_ID`.
- Lit le PDF via `node:fs/promises.readFile(formationPdfPath(docId))`.

- [ ] **Step 1: Écrire le test (échoue)**

Ajouter à `tests/server/dify-sync-router.test.ts` (mocks supplémentaires en tête du fichier) :
```ts
// près des autres vi.hoisted/vi.mock :
const { createDocumentByFile, updateDocumentByFile } = vi.hoisted(() => ({
  createDocumentByFile: vi.fn(), updateDocumentByFile: vi.fn(),
}))
// dans le vi.mock('@/server/dify/knowledge', ...) ajouter createDocumentByFile, updateDocumentByFile
const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('node:fs/promises', () => ({ default: { readFile }, readFile }))

// test :
test('pushFormationDoc creates a file document and upserts synced', async () => {
  process.env.DIFY_DOCS_DATASET_ID = 'docs-ds'
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, title: 'Cours' }]) // formationDocuments row
  readFile.mockResolvedValue(Buffer.from([0x25, 0x50, 0x44, 0x46]))
  createDocumentByFile.mockResolvedValue({ documentId: 'fdoc-1' })
  getSyncRow.mockResolvedValue(null)
  const out = await caller().difySync.pushFormationDoc({ docId: DRAFT_ID })
  expect(out).toEqual({ documentId: 'fdoc-1' })
  expect(createDocumentByFile).toHaveBeenCalledWith(
    expect.objectContaining({ datasetId: 'docs-ds', name: expect.stringContaining('Cours') }),
  )
  expect(upsertSync).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ sourceType: 'formation_doc', status: 'synced', difyDocumentId: 'fdoc-1' }),
  )
})

test('pushFormationDoc re-push uses updateDocumentByFile', async () => {
  process.env.DIFY_DOCS_DATASET_ID = 'docs-ds'
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, title: 'Cours' }])
  readFile.mockResolvedValue(Buffer.from([0x25]))
  getSyncRow.mockResolvedValue({ difyDocumentId: 'old-fdoc', datasetId: 'docs-ds' })
  await caller().difySync.pushFormationDoc({ docId: DRAFT_ID })
  expect(updateDocumentByFile).toHaveBeenCalledWith(
    expect.objectContaining({ documentId: 'old-fdoc', datasetId: 'docs-ds' }),
  )
  expect(createDocumentByFile).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/server/dify-sync-router.test.ts`
Expected: FAIL — `pushFormationDoc` absent.

- [ ] **Step 3: Implémenter**

Dans `src/server/trpc/routers/dify-sync.ts`, ajouter les imports :
```ts
import { readFile } from 'node:fs/promises'
import { formationDocuments } from '@/server/db/schema'
import { formationPdfPath } from '@/server/storage/uploads'
import { createDocumentByFile, updateDocumentByFile } from '@/server/dify/knowledge'
```
Ajouter la procédure au router :
```ts
  pushFormationDoc: adminProcedure
    .input(z.object({ docId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const datasetId = requireEnv('DIFY_DOCS_DATASET_ID')
      const [doc] = await ctx.db
        .select({ id: formationDocuments.id, title: formationDocuments.title })
        .from(formationDocuments)
        .where(eq(formationDocuments.id, input.docId))
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND' })

      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(await readFile(formationPdfPath(input.docId)))
      } catch {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'pdf_file_missing' })
      }
      const name = `${doc.title}.pdf`
      const existing = await getSyncRow(ctx.db, 'formation_doc', input.docId)

      try {
        let documentId: string
        if (existing?.difyDocumentId) {
          await updateDocumentByFile({
            datasetId: existing.datasetId, documentId: existing.difyDocumentId, name, bytes,
          })
          documentId = existing.difyDocumentId
        } else {
          ;({ documentId } = await createDocumentByFile({ datasetId, name, bytes }))
        }
        await upsertSync(ctx.db, {
          sourceType: 'formation_doc', sourceId: input.docId, datasetId,
          difyDocumentId: documentId, status: 'synced',
        })
        return { documentId }
      } catch (err) {
        await upsertSync(ctx.db, {
          sourceType: 'formation_doc', sourceId: input.docId, datasetId,
          difyDocumentId: existing?.difyDocumentId ?? null, status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'dify_push_failed' })
      }
    }),
```

- [ ] **Step 4: Lancer test + tsc, vérifier le vert**

Run: `npx vitest run tests/server/dify-sync-router.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/dify-sync.ts tests/server/dify-sync-router.test.ts
git commit -m "feat(dify): difySync.pushFormationDoc — push formation PDF to docs dataset"
```

---

### Task 10: UI — bouton + badge par document de formation

**Files:**
- Modify: l'écran admin de gestion des documents d'une formation (`src/app/admin/formations/[id]/page.tsx` et/ou son composant de liste de documents — repérer le composant qui rend la liste `formationDocuments`).
- Test: aucun test unitaire de composant — tsc + lint ; comportement serveur couvert par Task 9.

**Interfaces:**
- Consomme `difySync.pushFormationDoc` et `difySync.status({ sourceType: 'formation_doc', sourceIds })` (Task 9).

- [ ] **Step 1: Repérer le composant de liste des documents**

Lire `src/app/admin/formations/[id]/page.tsx` pour trouver où les `formationDocuments` sont listés et le pattern de mutation tRPC utilisé.

- [ ] **Step 2: Ajouter bouton + badge par document**

Pour chaque document : bouton « Pousser vers Dify » → `difySync.pushFormationDoc({ docId })` + badge d'état (lecture via `difySync.status`). État `pending`/erreur discriminé par document (pas global). Libellés FR.

- [ ] **Step 3: Vérifier lint + tsc**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/formations/
git commit -m "feat(admin): push-to-Dify button + sync badge per formation document"
```

---

### Task 11: Doc déploiement + vérification finale + smoke live

**Files:**
- Modify: `docs/DEPLOY.md` (ou `.env.example` si présent) — documenter les 3 envs.

- [ ] **Step 1: Documenter les envs**

Dans `docs/DEPLOY.md`, ajouter une section « Pont Knowledge Dify » :
- `DIFY_DATASET_API_KEY` — clé API Knowledge Dify (type *dataset*, distincte de `DIFY_API_KEY`).
- `DIFY_QA_DATASET_ID` — id du dataset Q&A.
- `DIFY_DOCS_DATASET_ID` — id du dataset documents (MASTER_FORMATIONS ou OCR).
Rappeler : poser dans Dokploy **ET** mapper dans le bloc `environment:` du service web du compose.

- [ ] **Step 2: Vérification complète**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: lint 0 warning, tsc 0 erreur, suite verte (≥ 528 + nouveaux tests).

- [ ] **Step 3: Commit doc**

```bash
git add docs/DEPLOY.md
git commit -m "docs(deploy): document Dify knowledge bridge env vars"
```

- [ ] **Step 4: Revue de branche**

Lancer `superpowers:requesting-code-review` (Fable 5) sur le diff `feat/dify-knowledge-bridge` vs `main`. Traiter via `superpowers:receiving-code-review`.

- [ ] **Step 5: Smoke test live (MANUEL, après déploiement + envs posées)**

Une fois la clé dataset et les IDs renseignés en prod :
1. Pousser une FAQ depuis le Cockpit → vérifier dans la console Dify que le document apparaît dans le dataset Q&A avec les bonnes paires Q/R.
2. Poser une question à BRAIN couverte par cette FAQ → vérifier la citation.
3. Pousser un PDF de formation → vérifier le document dans le dataset documents.
4. Re-pousser la même FAQ → vérifier l'absence de doublon (document remplacé).
**Si la sémantique Q&A diffère** (segments non pris en compte sur un doc create-by-text), ajuster `createQaDocument` selon la version Dify (cf. note Task 3) et re-livrer un correctif.

- [ ] **Step 6: Finalisation**

Via `superpowers:finishing-a-development-branch` : pousser la branche, ouvrir la PR, mettre à jour la mémoire projet formaps.

---

## Self-Review (auteur du plan)

**Couverture spec :**
- Config (3 envs, séparation clé) → Task 3 (knowledgeConfig) + Task 11 (doc) ✅
- Client Knowledge (createQaDocument, addSegments via createQaDocument, createByFile/updateByFile, deleteDocument) → Tasks 3+8 ✅
- Table `dify_sync` + enums + migration → Task 1 ✅
- Helpers store (upsert/get) → Task 4 ✅
- Router difySync (pushFaq, pushFormationDoc, unsync, status) → Tasks 5+9 ✅
- Mapping FAQ→segments → Task 2 ✅
- UI FAQ + formations → Tasks 6+10 ✅
- Gestion d'erreur (failed + error, source non affectée, unsync best-effort, timeout) → Tasks 3/5/9 ✅
- Tests (client fake fetch, mapping pur, router idempotence/échec, config absente) → Tasks 2/3/4/5/8/9 ✅
- Phasage Phase 1 FAQ / Phase 2 PDF → structure du plan ✅
- Hors scope (retrieval inverse, CRUD datasets, auto-push, indexing-status fin) → non planifiés ✅

**Placeholders :** aucun TODO/TBD ; code complet par step. Les 2 tâches UI (6, 10) renvoient à « repérer le pattern tRPC existant » faute de pouvoir prédire le composant exact, mais décrivent précisément l'ajout — l'exécutant lit le fichier réel (pattern admin déjà établi).

**Cohérence des types :** `DifyQaSegment` (Task 2) ↔ `createQaDocument.segments` (Task 3) ↔ router (Task 5). `createDocumentByFile`/`updateDocumentByFile` (Task 8) ↔ router (Task 9). `upsertSync`/`getSyncRow` signatures (Task 4) ↔ appels routers (Tasks 5,9). `formationPdfPath` (Task 7) ↔ Task 9. `difySync` table (Task 1) ↔ store (Task 4) + router status/unsync. Cohérents.

**Risques documentés :** sémantique exacte de la Knowledge API Q&A (Task 3 note + Task 11 smoke) ; dépendance aux creds dataset pour le smoke live (Task 11, non bloquant pour le code+tests).
