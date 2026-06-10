# FAQ Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Outil admin qui génère une FAQ (Claude Sonnet 4.6) depuis un PDF/.docx uploadé, édition persistante des paires Q/R, export CSV au format Q&A Dify.

**Architecture:** POST multipart (extraction unpdf/mammoth + 1 appel Claude tool-use forcé + création d'un brouillon `faq_drafts`), édition via routeur tRPC admin `faqBuilder`, « Générer plus » relit le `source_text` stocké, export CSV côté client. Le cœur Claude (`forcedToolCall` + client) est extrait du labo d'embed vers un module partagé.

**Tech Stack:** Next.js 16 App Router, tRPC v11, Drizzle/Postgres (jsonb), @anthropic-ai/sdk (tool use forcé), unpdf (existant), mammoth (nouveau), zod 4, vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-06-10-faq-builder-design.md` (validée).

**Conventions du repo à respecter:**
- Tests dans `tests/server/`, `tests/lib/`, `tests/components/` ; route handlers testés avec `// @vitest-environment node` en tête de fichier (jsdom casse FormData/undici).
- Texte UI en français, code/commits en anglais.
- Client tRPC : `import { trpc } from '@/lib/trpc/client'` ; usage `trpc.admin.faqBuilder.list.useQuery()`.
- Classes Tailwind du design system : `text-sub`, `text-faint`, `text-ink`, `border-line`, `bg-card`, `bg-surface`, `bg-red`, `text-red`, `font-serif`.
- Vérifier `npm run lint` ET `npm run typecheck` avant chaque commit (CI les gate).

---

### Task 0: Branche de travail

- [ ] **Step 1: Créer la branche depuis main à jour**

```bash
git checkout main && git pull && git checkout -b feat/faq-builder
```

Note : main contient déjà la spec (commit local `9af8cc5`) — elle partira avec la PR.

---

### Task 1: Extraire le cœur Claude partagé (`claude-core.ts`)

Refactor pur : `createAnthropicClient`, `AnthropicLike`, `Usage`, `forcedToolCall` et le `responseSchema` privé sortent de `src/server/embed-test/claude.ts` vers un module partagé. Comportement byte-identical, les tests embed-test existants restent verts sans modification.

**Files:**
- Create: `src/server/claude-core.ts`
- Modify: `src/server/embed-test/claude.ts:1-70`

- [ ] **Step 1: Créer `src/server/claude-core.ts`**

```ts
/**
 * Shared Claude API core: client factory + forced-tool-use call helper.
 * Server-only. Extracted from the embed-test lab so other admin tools
 * (FAQ builder) reuse the same test seam and structured-output mechanics.
 *
 * Structured outputs via FORCED tool use (tool_choice type:'tool' + strict
 * input schema): the response is always a tool_use block whose input the
 * caller validates with zod. The client is injected so tests pass a fake.
 */
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

/** Structural subset of the Anthropic client used here (test seam). */
export type AnthropicLike = {
  messages: { create: (params: Anthropic.MessageCreateParams) => Promise<unknown> }
}

export function createAnthropicClient(): AnthropicLike {
  // SDK auto-retries 429/5xx with backoff (default maxRetries: 2).
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

export type Usage = { inputTokens: number; outputTokens: number }

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string() }).loose()),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
})

export async function forcedToolCall(
  client: AnthropicLike,
  model: string,
  prompt: string | Anthropic.ContentBlockParam[],
  toolName: string,
  description: string,
  inputSchema: Anthropic.Tool.InputSchema,
): Promise<{ input: unknown; usage: Usage }> {
  const raw = await client.messages.create({
    model,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
    tools: [
      { name: toolName, description, strict: true, input_schema: inputSchema },
    ],
    tool_choice: { type: 'tool', name: toolName },
  })
  const res = responseSchema.parse(raw)
  const block = res.content.find((b) => b.type === 'tool_use') as
    | { type: 'tool_use'; input: unknown }
    | undefined
  if (!block) throw new Error('Claude response carried no tool_use block')
  return {
    input: block.input,
    usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
  }
}
```

- [ ] **Step 2: Modifier `src/server/embed-test/claude.ts`**

Supprimer les définitions locales de `AnthropicLike`, `createAnthropicClient`, `Usage`, `responseSchema`, `forcedToolCall` (lignes ~27-70) et remplacer par un import + ré-export (les consommateurs existants — `pipeline.ts`, tests — importent depuis `embed-test/claude`) :

```ts
import {
  forcedToolCall,
  createAnthropicClient,
  type AnthropicLike,
  type Usage,
} from '@/server/claude-core'

export { createAnthropicClient }
export type { AnthropicLike, Usage }
```

L'import `import Anthropic from '@anthropic-ai/sdk'` et `import { z } from 'zod'` restent (utilisés par les schémas tool). Le doc-comment de tête du fichier reste. Rien d'autre ne change.

- [ ] **Step 3: Vérifier que tout reste vert**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 erreur tsc, 0 warning, 381/381 tests (aucun test modifié).

- [ ] **Step 4: Commit**

```bash
git add src/server/claude-core.ts src/server/embed-test/claude.ts
git commit -m "refactor: extract shared Claude core from embed-test"
```

---

### Task 2: Schéma `faq_drafts` + types partagés + migration 0007

**Files:**
- Create: `src/lib/faq/types.ts`
- Modify: `src/server/db/schema.ts` (import jsonb + table en fin de fichier)
- Create (générée): `drizzle/0007_*.sql`
- Test: `tests/lib/faq-types.test.ts`

- [ ] **Step 1: Écrire le test des types (rouge)**

`tests/lib/faq-types.test.ts` :

```ts
import { expect, test } from 'vitest'

import { faqItemSchema } from '@/lib/faq/types'

const VALID = {
  id: '6f9619ff-8b86-4d01-b42d-00c04fc964ff',
  question: 'Quand mon magasin bascule-t-il ?',
  answer: 'La date J est fixée par magasin dans le Cockpit.',
  origin: 'generated',
}

test('faqItemSchema accepte une paire valide', () => {
  expect(faqItemSchema.parse(VALID)).toEqual(VALID)
})

test('faqItemSchema rejette question vide, réponse vide, origin inconnu, id non-uuid', () => {
  expect(faqItemSchema.safeParse({ ...VALID, question: '' }).success).toBe(false)
  expect(faqItemSchema.safeParse({ ...VALID, answer: '   ' }).success).toBe(false)
  expect(faqItemSchema.safeParse({ ...VALID, origin: 'imported' }).success).toBe(false)
  expect(faqItemSchema.safeParse({ ...VALID, id: 'nope' }).success).toBe(false)
})
```

- [ ] **Step 2: Run pour vérifier l'échec**

Run: `npx vitest run tests/lib/faq-types.test.ts`
Expected: FAIL (module `@/lib/faq/types` introuvable).

- [ ] **Step 3: Créer `src/lib/faq/types.ts`**

```ts
import { z } from 'zod'

/**
 * One FAQ pair inside a draft. Shared client/server: the editor manipulates
 * these, `faq_drafts.items` (jsonb) stores the ordered array, and the tRPC
 * `updateItems` input validates against it.
 */
export const faqItemSchema = z.object({
  id: z.uuid(),
  question: z.string().trim().min(1).max(2000),
  answer: z.string().trim().min(1).max(8000),
  origin: z.enum(['generated', 'manual']),
})

export type FaqItem = z.infer<typeof faqItemSchema>
```

Note zod 4 : `z.uuid()` est la forme canonique (si le typecheck la refuse avec la version installée, utiliser `z.string().uuid()` — vérifier l'usage existant dans `src/server/trpc/routers/admin.ts`).

⚠️ `.trim()` zod TRANSFORME (il ne fait pas que valider) : `'  x  '` parse vers `'x'`. Le test Step 1 utilise des valeurs sans espaces de bord pour rester en `toEqual` strict.

- [ ] **Step 4: Ajouter la table dans `src/server/db/schema.ts`**

Dans la ligne d'import existante (ligne 1), ajouter `jsonb` :

```ts
import { pgTable, uuid, text, integer, date, timestamp, boolean, pgEnum, unique, real, index, primaryKey, jsonb } from 'drizzle-orm/pg-core'
```

En fin de fichier, ajouter :

```ts
import type { FaqItem } from '@/lib/faq/types'

/**
 * FAQ builder drafts (admin tool). `sourceText` keeps the extracted document
 * text so "Générer plus" re-prompts Claude without re-uploading the file.
 * `items` is the ordered Q/A list, replaced atomically by `updateItems`.
 */
export const faqDrafts = pgTable('faq_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceFilename: text('source_filename').notNull(),
  sourceText: text('source_text').notNull(),
  items: jsonb('items').$type<FaqItem[]>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
```

(Déplacer l'`import type` en tête de fichier avec les autres imports — convention du fichier.)

- [ ] **Step 5: Générer la migration**

Run: `npm run db:generate`
Expected: nouveau fichier `drizzle/0007_<nom-généré>.sql` contenant `CREATE TABLE "faq_drafts" (...)` + entrée idx 7 dans `drizzle/meta/_journal.json`. Vérifier le SQL : 6 colonnes, `items` en jsonb NOT NULL, pas d'ALTER parasite sur d'autres tables.

- [ ] **Step 6: Vérifier tests + typecheck**

Run: `npx vitest run tests/lib/faq-types.test.ts && npm run typecheck`
Expected: 2 tests PASS, tsc 0 erreur.

- [ ] **Step 7: Appliquer la migration sur la base dev**

Run: `npm run db:migrate`
Expected: migration 0007 appliquée sans erreur (Postgres dev local `formaps_postgres`, port 5433).

- [ ] **Step 8: Commit**

```bash
git add src/lib/faq/types.ts src/server/db/schema.ts drizzle/
git commit -m "feat(faq-builder): faq_drafts table, shared item schema, migration 0007"
```

---

### Task 3: Extraction .docx (`mammoth`)

**Files:**
- Modify: `package.json` (dépendance)
- Create: `src/server/faq/extract-docx.ts`
- Test: `tests/server/faq-extract-docx.test.ts`

- [ ] **Step 1: Installer mammoth**

Run: `npm install mammoth`
Expected: ajouté aux `dependencies` (pas dev — utilisé au runtime serveur).

- [ ] **Step 2: Écrire le test (rouge)**

`tests/server/faq-extract-docx.test.ts` :

```ts
import { beforeEach, expect, test, vi } from 'vitest'

const extractRawText = vi.hoisted(() => vi.fn())
vi.mock('mammoth', () => ({ default: { extractRawText } }))

import { DocxUnreadableError, extractDocxText } from '@/server/faq/extract-docx'

beforeEach(() => {
  extractRawText.mockReset()
})

test('retourne le texte brut extrait par mammoth', async () => {
  extractRawText.mockResolvedValue({ value: 'Bonjour le texte', messages: [] })
  await expect(extractDocxText(new Uint8Array([1, 2]))).resolves.toBe('Bonjour le texte')
  expect(extractRawText).toHaveBeenCalledWith({ buffer: expect.any(Buffer) })
})

test('un échec mammoth devient DocxUnreadableError', async () => {
  extractRawText.mockRejectedValue(new Error('corrupt zip'))
  await expect(extractDocxText(new Uint8Array([1, 2]))).rejects.toBeInstanceOf(
    DocxUnreadableError,
  )
})
```

- [ ] **Step 3: Run pour vérifier l'échec**

Run: `npx vitest run tests/server/faq-extract-docx.test.ts`
Expected: FAIL (module `@/server/faq/extract-docx` introuvable).

- [ ] **Step 4: Créer `src/server/faq/extract-docx.ts`**

```ts
/**
 * .docx raw-text extraction for the FAQ builder. Server-only.
 * Mirrors the PdfUnreadableError contract of embed-test/extract.ts.
 */
import mammoth from 'mammoth'

/** Corrupted, password-protected, or not-a-docx input. */
export class DocxUnreadableError extends Error {
  constructor(cause?: unknown) {
    super('DOCX illisible — protégé ou corrompu')
    this.name = 'DocxUnreadableError'
    this.cause = cause
  }
}

export async function extractDocxText(buffer: Uint8Array): Promise<string> {
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) })
    return value
  } catch (err) {
    throw new DocxUnreadableError(err)
  }
}
```

- [ ] **Step 5: Vérifier vert + qualité**

Run: `npx vitest run tests/server/faq-extract-docx.test.ts && npm run typecheck && npm run lint`
Expected: 2 PASS, tsc/lint propres.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/server/faq/extract-docx.ts tests/server/faq-extract-docx.test.ts
git commit -m "feat(faq-builder): docx raw-text extraction via mammoth"
```

---

### Task 4: Génération initiale (`generateFaqPairs`)

**Files:**
- Create: `src/server/faq/claude.ts`
- Test: `tests/server/faq-claude.test.ts`

- [ ] **Step 1: Écrire les tests (rouges)**

`tests/server/faq-claude.test.ts` :

```ts
import { expect, test } from 'vitest'

import type { AnthropicLike } from '@/server/claude-core'
import { FAQ_MODEL, generateFaqPairs, questionKey } from '@/server/faq/claude'

/** Fake Anthropic client returning the given tool_use inputs, call after call. */
function fakeClient(...inputs: unknown[]): AnthropicLike & { calls: unknown[] } {
  const calls: unknown[] = []
  let i = 0
  return {
    calls,
    messages: {
      create: async (params: unknown) => {
        calls.push(params)
        const input = inputs[Math.min(i, inputs.length - 1)]
        i += 1
        return {
          content: [{ type: 'tool_use', input }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }
      },
    },
  }
}

test('questionKey normalise casse, accents, ponctuation et espaces', () => {
  expect(questionKey('  Quand   BASCULE-t-on ?! ')).toBe(questionKey('quand bascule t on'))
  expect(questionKey('Où est la cantine ?')).toBe(questionKey('ou est la cantine'))
})

test('generateFaqPairs valide par paire et déduplique les questions équivalentes', async () => {
  const client = fakeClient({
    pairs: [
      { question: 'Quand bascule-t-on ?', answer: 'À la date J du magasin.' },
      { question: 'QUAND bascule t on', answer: 'Doublon à écarter.' },
      { question: 'Sans réponse', answer: '' }, // invalide → écartée
      { question: 'Comment me former ?', answer: "Via l'Espace Formation." },
    ],
  })
  const { data } = await generateFaqPairs(client, 'texte source')
  expect(data).toEqual([
    { question: 'Quand bascule-t-on ?', answer: 'À la date J du magasin.' },
    { question: 'Comment me former ?', answer: "Via l'Espace Formation." },
  ])
  const params = client.calls[0] as { model: string; tool_choice: { type: string } }
  expect(params.model).toBe(FAQ_MODEL)
  expect(params.tool_choice.type).toBe('tool')
})

test('generateFaqPairs jette si aucune paire valide', async () => {
  const client = fakeClient({ pairs: [{ question: '', answer: '' }] })
  await expect(generateFaqPairs(client, 'texte')).rejects.toThrow(/no valid FAQ pair/)
})

test('le prompt contient le document et les règles autoportantes', async () => {
  const client = fakeClient({ pairs: [{ question: 'Q ?', answer: 'R.' }] })
  await generateFaqPairs(client, 'CONTENU-SENTINELLE')
  const params = client.calls[0] as { messages: [{ content: string }] }
  expect(params.messages[0].content).toContain('CONTENU-SENTINELLE')
  expect(params.messages[0].content).toContain('AUTOPORTANTE')
})
```

- [ ] **Step 2: Run pour vérifier l'échec**

Run: `npx vitest run tests/server/faq-claude.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Créer `src/server/faq/claude.ts`**

```ts
/**
 * Claude calls for the FAQ builder. Server-only. Model is FIXED to Sonnet 4.6
 * (spec decision — no selector). Reuses the shared forced-tool-use core.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { forcedToolCall, type AnthropicLike, type Usage } from '@/server/claude-core'

export const FAQ_MODEL = 'claude-sonnet-4-6'

/** Cap on the document text sent to Claude (~110k tokens of French). */
const SOURCE_CHAR_CAP = 400_000

const pairSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  answer: z.string().trim().min(1).max(8000),
})
export type FaqPair = z.infer<typeof pairSchema>

const PAIRS_TOOL_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object',
  properties: {
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Question en français, point de vue salarié',
          },
          answer: {
            type: 'string',
            description: 'Réponse autoportante en français',
          },
        },
        required: ['question', 'answer'],
        additionalProperties: false,
      },
    },
  },
  required: ['pairs'],
  additionalProperties: false,
}

// Raw envelope only — each pair is validated individually so one invalid
// entry does not fail the whole batch (same pattern as embed-test).
const envelopeSchema = z.object({ pairs: z.array(z.unknown()) })

/**
 * Normalized dedup key for questions: lowercase, diacritics stripped,
 * punctuation removed, whitespace squeezed. "Ne re-propose pas" in the prompt
 * is not enough — dedup happens in code (see feedback_llm_propose_dedup_retry).
 */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildPrompt(sourceText: string, extraBlocks = ''): string {
  const truncated = sourceText.length > SOURCE_CHAR_CAP
  const text = truncated ? sourceText.slice(0, SOURCE_CHAR_CAP) : sourceText
  const truncNote = truncated
    ? ` (document tronqué aux ${SOURCE_CHAR_CAP} premiers caractères)`
    : ''
  return (
    "Tu prépares la FAQ d'un portail interne pour les salariés d'un supermarché " +
    "A⁺SUPER en pleine bascule d'enseigne Auchan → Intermarché. À partir du document " +
    'ci-dessous, rédige des paires question/réponse en français qui couvrent TOUT le ' +
    `contenu utile du document${truncNote}.\n` +
    'Règles :\n' +
    '- Les questions sont formulées du point de vue d’un salarié (« Comment… ? », ' +
    '« Quand… ? », « Que faire si… ? »).\n' +
    '- Chaque réponse est AUTOPORTANTE : elle sera lue seule, sans le document — ' +
    'aucune référence du type « voir la section X » ou « comme indiqué ci-dessus », ' +
    'sigles développés à leur première occurrence.\n' +
    '- Autant de paires que le contenu le justifie : couvre chaque sujet distinct, ' +
    "sans inventer ce qui n'est pas dans le document.\n\n" +
    extraBlocks +
    '--- DOCUMENT ---\n' +
    text
  )
}

type Attempt = { fresh: FaqPair[]; duplicates: FaqPair[]; usage: Usage }

/** One forced tool call + per-pair safeParse + dedup vs `existingKeys`. */
async function pairsAttempt(
  client: AnthropicLike,
  prompt: string,
  existingKeys: Set<string>,
): Promise<Attempt> {
  const { input, usage } = await forcedToolCall(
    client,
    FAQ_MODEL,
    prompt,
    'output',
    'Rapporte les paires question/réponse de la FAQ',
    PAIRS_TOOL_SCHEMA,
  )
  const envelope = envelopeSchema.parse(input)
  const fresh: FaqPair[] = []
  const duplicates: FaqPair[] = []
  const seen = new Set(existingKeys)
  for (const entry of envelope.pairs) {
    const parsed = pairSchema.safeParse(entry)
    if (!parsed.success) continue
    const key = questionKey(parsed.data.question)
    if (seen.has(key)) duplicates.push(parsed.data)
    else {
      seen.add(key)
      fresh.push(parsed.data)
    }
  }
  return { fresh, duplicates, usage }
}

export async function generateFaqPairs(
  client: AnthropicLike,
  sourceText: string,
): Promise<{ data: FaqPair[]; usage: Usage }> {
  const { fresh, usage } = await pairsAttempt(client, buildPrompt(sourceText), new Set())
  if (fresh.length < 1) throw new Error('Claude returned no valid FAQ pair')
  return { data: fresh, usage }
}
```

- [ ] **Step 4: Vérifier vert + qualité**

Run: `npx vitest run tests/server/faq-claude.test.ts && npm run typecheck && npm run lint`
Expected: 4 PASS, tsc/lint propres.

- [ ] **Step 5: Commit**

```bash
git add src/server/faq/claude.ts tests/server/faq-claude.test.ts
git commit -m "feat(faq-builder): initial FAQ generation via forced tool use"
```

---

### Task 5: « Générer plus » (`generateMorePairs`, dédup + retry)

**Files:**
- Modify: `src/server/faq/claude.ts` (ajout en fin de fichier)
- Test: `tests/server/faq-claude.test.ts` (ajout)

- [ ] **Step 1: Ajouter les tests (rouges)** dans `tests/server/faq-claude.test.ts`

Ajouter `generateMorePairs` à l'import existant, puis :

```ts
test('generateMorePairs écarte les questions déjà présentes (modulo normalisation)', async () => {
  const client = fakeClient({
    pairs: [
      { question: 'Quand bascule-t-on ?', answer: 'Déjà présente.' },
      { question: 'Où trouver mon planning ?', answer: 'Nouvelle.' },
    ],
  })
  const { data } = await generateMorePairs(client, 'doc', ['QUAND bascule t on !'])
  expect(data).toEqual([{ question: 'Où trouver mon planning ?', answer: 'Nouvelle.' }])
  expect(client.calls).toHaveLength(1)
})

test('generateMorePairs : tout doublon → un retry listant les rejets', async () => {
  const client = fakeClient(
    { pairs: [{ question: 'Quand bascule-t-on ?', answer: 'Doublon.' }] },
    { pairs: [{ question: 'Qui contacter en cas de souci ?', answer: 'Le référent.' }] },
  )
  const { data } = await generateMorePairs(client, 'doc', ['Quand bascule-t-on ?'])
  expect(data).toEqual([
    { question: 'Qui contacter en cas de souci ?', answer: 'Le référent.' },
  ])
  expect(client.calls).toHaveLength(2)
  const retry = client.calls[1] as { messages: [{ content: string }] }
  expect(retry.messages[0].content).toContain('PROPOSITIONS REJETÉES')
  expect(retry.messages[0].content).toContain('Quand bascule-t-on ?')
})

test('generateMorePairs : retry encore en doublon → erreur explicite', async () => {
  const client = fakeClient(
    { pairs: [{ question: 'Quand bascule-t-on ?', answer: 'Doublon.' }] },
    { pairs: [{ question: 'quand bascule t on', answer: 'Encore doublon.' }] },
  )
  await expect(generateMorePairs(client, 'doc', ['Quand bascule-t-on ?'])).rejects.toThrow(
    /no new FAQ pair/,
  )
})

test('le prompt de generateMorePairs liste les questions existantes', async () => {
  const client = fakeClient({ pairs: [{ question: 'Neuve ?', answer: 'Oui.' }] })
  await generateMorePairs(client, 'doc', ['Question existante A'])
  const params = client.calls[0] as { messages: [{ content: string }] }
  expect(params.messages[0].content).toContain('QUESTIONS DÉJÀ PRÉSENTES')
  expect(params.messages[0].content).toContain('Question existante A')
})
```

- [ ] **Step 2: Run pour vérifier l'échec**

Run: `npx vitest run tests/server/faq-claude.test.ts`
Expected: les 4 nouveaux FAIL (`generateMorePairs` non exporté), les 4 anciens PASS.

- [ ] **Step 3: Implémenter** en fin de `src/server/faq/claude.ts`

```ts
export async function generateMorePairs(
  client: AnthropicLike,
  sourceText: string,
  existingQuestions: string[],
): Promise<{ data: FaqPair[]; usage: Usage }> {
  const existingKeys = new Set(existingQuestions.map(questionKey))
  const existingBlock =
    '--- QUESTIONS DÉJÀ PRÉSENTES (ne JAMAIS reproposer une question identique ou ' +
    'équivalente) ---\n' +
    existingQuestions.map((q) => `- ${q}`).join('\n') +
    '\n\nPropose uniquement des paires INÉDITES sur des sujets du document non ' +
    'couverts ci-dessus.\n\n'

  const first = await pairsAttempt(client, buildPrompt(sourceText, existingBlock), existingKeys)
  if (first.fresh.length >= 1) return { data: first.fresh, usage: first.usage }

  // Everything came back as a duplicate: one retry with explicit feedback.
  // (No attempt-1 survivors to rescue here — the retry only fires at 0 fresh.)
  const feedbackBlock =
    '--- ATTENTION : PROPOSITIONS REJETÉES ---\n' +
    `Tu viens de proposer ${first.duplicates.length} question(s) déjà présentes : ` +
    first.duplicates.map((p) => `« ${p.question} »`).join(', ') +
    ".\nPropose des questions portant sur D'AUTRES SUJETS du document.\n\n"
  const second = await pairsAttempt(
    client,
    buildPrompt(sourceText, existingBlock + feedbackBlock),
    existingKeys,
  )
  const usage: Usage = {
    inputTokens: first.usage.inputTokens + second.usage.inputTokens,
    outputTokens: first.usage.outputTokens + second.usage.outputTokens,
  }
  if (second.fresh.length < 1) throw new Error('Claude returned no new FAQ pair after retry')
  return { data: second.fresh, usage }
}
```

- [ ] **Step 4: Vérifier vert + qualité**

Run: `npx vitest run tests/server/faq-claude.test.ts && npm run typecheck && npm run lint`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/faq/claude.ts tests/server/faq-claude.test.ts
git commit -m "feat(faq-builder): generate-more with code dedup and one retry"
```

---

### Task 6: Route `POST /api/admin/faq-builder`

**Files:**
- Create: `src/app/api/admin/faq-builder/route.ts`
- Test: `tests/server/faq-builder-route.test.ts`

- [ ] **Step 1: Écrire les tests (rouges)**

`tests/server/faq-builder-route.test.ts` (⚠️ première ligne = directive environnement) :

```ts
// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest'

const { auth, extractPages, extractDocxText, generateFaqPairs, insertReturning } = vi.hoisted(
  () => ({
    auth: vi.fn(),
    extractPages: vi.fn(),
    extractDocxText: vi.fn(),
    generateFaqPairs: vi.fn(),
    insertReturning: vi.fn(),
  }),
)

vi.mock('@/server/auth', () => ({ auth }))
vi.mock('@/server/embed-test/extract', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  extractPages,
}))
vi.mock('@/server/faq/extract-docx', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  extractDocxText,
}))
vi.mock('@/server/faq/claude', () => ({ generateFaqPairs }))
vi.mock('@/server/claude-core', () => ({ createAnthropicClient: vi.fn(() => ({})) }))
vi.mock('@/server/db', () => ({
  db: { insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertReturning })) })) },
}))

import { POST } from '@/app/api/admin/faq-builder/route'

const ADMIN = { user: { id: 'a1', role: 'admin' } }
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) // "%PDF-"
const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]) // "PK\x03\x04"

function request(name: string, bytes: Uint8Array): Request {
  const form = new FormData()
  form.set('file', new File([bytes], name))
  return new Request('http://test/api/admin/faq-builder', { method: 'POST', body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  auth.mockResolvedValue(ADMIN)
  extractPages.mockResolvedValue({ pages: ['x'.repeat(300)], totalPages: 1 })
  extractDocxText.mockResolvedValue('y'.repeat(300))
  generateFaqPairs.mockResolvedValue({
    data: [{ question: 'Q ?', answer: 'R.' }],
    usage: { inputTokens: 1, outputTokens: 1 },
  })
  insertReturning.mockResolvedValue([{ id: 'draft-1' }])
})

test('non connecté → 401, non admin → 403', async () => {
  auth.mockResolvedValueOnce(null)
  expect((await POST(request('a.pdf', PDF_BYTES))).status).toBe(401)
  auth.mockResolvedValueOnce({ user: { id: 'u1', role: 'employee' } })
  expect((await POST(request('a.pdf', PDF_BYTES))).status).toBe(403)
})

test('clé API absente → 503', async () => {
  delete process.env.ANTHROPIC_API_KEY
  expect((await POST(request('a.pdf', PDF_BYTES))).status).toBe(503)
})

test('extension ou magic bytes invalides → 415', async () => {
  expect((await POST(request('a.txt', PDF_BYTES))).status).toBe(415)
  expect((await POST(request('a.pdf', DOCX_BYTES))).status).toBe(415)
  expect((await POST(request('a.docx', PDF_BYTES))).status).toBe(415)
})

test('texte extrait < 200 caractères → 422 empty_text', async () => {
  extractPages.mockResolvedValue({ pages: ['court'], totalPages: 1 })
  const res = await POST(request('a.pdf', PDF_BYTES))
  expect(res.status).toBe(422)
  expect(await res.json()).toEqual({ error: 'empty_text' })
})

test('PDF valide → extraction unpdf, génération, 201 avec id', async () => {
  const res = await POST(request('doc.pdf', PDF_BYTES))
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ id: 'draft-1', count: 1 })
  expect(extractPages).toHaveBeenCalled()
  expect(extractDocxText).not.toHaveBeenCalled()
})

test('docx valide → extraction mammoth, 201', async () => {
  const res = await POST(request('doc.docx', DOCX_BYTES))
  expect(res.status).toBe(201)
  expect(extractDocxText).toHaveBeenCalled()
  expect(extractPages).not.toHaveBeenCalled()
})

test('génération Claude en échec → 502, pas de brouillon créé', async () => {
  generateFaqPairs.mockRejectedValue(new Error('boom'))
  const res = await POST(request('doc.pdf', PDF_BYTES))
  expect(res.status).toBe(502)
  expect(insertReturning).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run pour vérifier l'échec**

Run: `npx vitest run tests/server/faq-builder-route.test.ts`
Expected: FAIL (module route introuvable).

- [ ] **Step 3: Créer `src/app/api/admin/faq-builder/route.ts`**

```ts
import { randomUUID } from 'node:crypto'

import { auth } from '@/server/auth'
import { db } from '@/server/db'
import { faqDrafts } from '@/server/db/schema'
import { createAnthropicClient } from '@/server/claude-core'
import { generateFaqPairs } from '@/server/faq/claude'
import { extractPages, PdfUnreadableError } from '@/server/embed-test/extract'
import { DocxUnreadableError, extractDocxText } from '@/server/faq/extract-docx'
import type { FaqItem } from '@/lib/faq/types'

export const runtime = 'nodejs'

const MAX_SIZE = 25 * 1024 * 1024 // same ceiling as embed-test
const MIN_TEXT_CHARS = 200 // below this the document is likely scanned (spec)

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Extension AND magic bytes must agree — both checked (audit convention). */
function sniffKind(name: string, bytes: Uint8Array): 'pdf' | 'docx' | null {
  const lower = name.toLowerCase()
  const isPdf =
    bytes.length >= 4 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 // %PDF
  const isZip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 // PK\x03\x04
  if (lower.endsWith('.pdf') && isPdf) return 'pdf'
  if (lower.endsWith('.docx') && isZip) return 'docx'
  return null
}

/**
 * FAQ builder generation: multipart PDF/.docx in, one Claude call, one
 * `faq_drafts` row out. Admin only. The extracted text is persisted so
 * "Générer plus" works later without re-uploading the file.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user) return json({ error: 'unauthorized' }, 401)
  if (session.user.role !== 'admin') return json({ error: 'forbidden' }, 403)
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'anthropic_not_configured' }, 503)

  let file: File
  try {
    const form = await req.formData()
    const raw = form.get('file')
    if (!(raw instanceof File)) return json({ error: 'file_required' }, 400)
    file = raw
  } catch {
    return json({ error: 'invalid_form' }, 400)
  }
  if (file.size > MAX_SIZE) return json({ error: 'file_too_large' }, 413)

  const buffer = new Uint8Array(await file.arrayBuffer())
  const kind = sniffKind(file.name, buffer)
  if (!kind) return json({ error: 'invalid_type' }, 415)

  let text: string
  try {
    text =
      kind === 'pdf'
        ? (await extractPages(buffer)).pages.join('\n\n')
        : await extractDocxText(buffer)
  } catch (err) {
    if (err instanceof PdfUnreadableError || err instanceof DocxUnreadableError) {
      return json({ error: 'unreadable_document' }, 422)
    }
    throw err
  }
  if (text.trim().length < MIN_TEXT_CHARS) return json({ error: 'empty_text' }, 422)

  let pairs
  try {
    pairs = (await generateFaqPairs(createAnthropicClient(), text)).data
  } catch (err) {
    console.error('[faq-builder] generation failed:', err)
    return json({ error: 'generation_failed' }, 502)
  }

  const items: FaqItem[] = pairs.map((p) => ({
    id: randomUUID(),
    question: p.question,
    answer: p.answer,
    origin: 'generated',
  }))
  const [draft] = await db
    .insert(faqDrafts)
    .values({ sourceFilename: file.name, sourceText: text, items })
    .returning({ id: faqDrafts.id })
  return json({ id: draft.id, count: items.length }, 201)
}
```

- [ ] **Step 4: Vérifier vert + qualité**

Run: `npx vitest run tests/server/faq-builder-route.test.ts && npm run typecheck && npm run lint`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/faq-builder/route.ts tests/server/faq-builder-route.test.ts
git commit -m "feat(faq-builder): admin multipart generation route"
```

---

### Task 7: Routeur tRPC `faqBuilder`

**Files:**
- Create: `src/server/trpc/routers/admin-faq-builder.ts`
- Modify: `src/server/trpc/routers/admin.ts:36` (import) et `:475-482` (registration)
- Test: `tests/server/admin-faq-builder.test.ts`

- [ ] **Step 1: Écrire les tests (rouges)**

`tests/server/admin-faq-builder.test.ts` — suit le pattern caller de `tests/server/admin-users-password.test.ts` (mocks chaînés drizzle, ctx `as never`) :

```ts
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('@/server/auth', () => ({ auth: vi.fn() }))
vi.mock('@/server/db', () => ({ db: {} }))

const { generateMorePairs } = vi.hoisted(() => ({ generateMorePairs: vi.fn() }))
vi.mock('@/server/faq/claude', () => ({ generateMorePairs }))
vi.mock('@/server/claude-core', () => ({ createAnthropicClient: vi.fn(() => ({})) }))

// drizzle chain mocks: select().from().where() / .orderBy(), update().set().where().returning(), delete().where().returning()
const selectWhere = vi.fn()
const selectOrderBy = vi.fn()
const selectFrom = vi.fn(() => ({ where: selectWhere, orderBy: selectOrderBy }))
const updateReturning = vi.fn()
const updateWhere = vi.fn(() => ({ returning: updateReturning }))
const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }))
const deleteReturning = vi.fn()
const deleteWhere = vi.fn(() => ({ returning: deleteReturning }))
const dbMock = {
  select: vi.fn(() => ({ from: selectFrom })),
  update: vi.fn(() => ({ set: updateSet })),
  delete: vi.fn(() => ({ where: deleteWhere })),
} as never

import { adminRouter } from '@/server/trpc/routers/admin'
import { createCallerFactory } from '@/server/trpc/trpc'

const createCaller = createCallerFactory(adminRouter)
const DRAFT_ID = '6f9619ff-8b86-4d01-b42d-00c04fc964ff'
const ITEM = {
  id: '7f9619ff-8b86-4d01-b42d-00c04fc964ff',
  question: 'Q ?',
  answer: 'R.',
  origin: 'generated' as const,
}

function caller(role: 'admin' | 'employee' = 'admin') {
  return createCaller({
    session: {
      user: { id: 'admin1', role, storeId: null, firstName: 'Admin', email: 'adm@b.fr' },
      expires: '',
    },
    db: dbMock,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

test('list mappe vers itemCount sans exposer sourceText', async () => {
  selectOrderBy.mockResolvedValue([
    { id: DRAFT_ID, sourceFilename: 'a.pdf', items: [ITEM, ITEM], updatedAt: new Date(0) },
  ])
  const rows = await caller().faqBuilder.list()
  expect(rows).toEqual([
    { id: DRAFT_ID, sourceFilename: 'a.pdf', itemCount: 2, updatedAt: new Date(0) },
  ])
})

test('get inconnu → NOT_FOUND ; non-admin → FORBIDDEN', async () => {
  selectWhere.mockResolvedValue([])
  await expect(caller().faqBuilder.get({ id: DRAFT_ID })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
  await expect(caller('employee').faqBuilder.list()).rejects.toMatchObject({
    code: 'FORBIDDEN',
  })
})

test('updateItems remplace la liste et bump updatedAt', async () => {
  updateReturning.mockResolvedValue([{ id: DRAFT_ID }])
  await caller().faqBuilder.updateItems({ id: DRAFT_ID, items: [ITEM] })
  expect(updateSet).toHaveBeenCalledWith(
    expect.objectContaining({ items: [ITEM], updatedAt: expect.any(Date) }),
  )
})

test('updateItems rejette une paire vide (zod)', async () => {
  await expect(
    caller().faqBuilder.updateItems({ id: DRAFT_ID, items: [{ ...ITEM, question: '' }] }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
})

test('generateMore ajoute en fin de liste avec origin generated', async () => {
  selectWhere.mockResolvedValue([
    { id: DRAFT_ID, sourceText: 'doc', items: [ITEM] },
  ])
  updateReturning.mockResolvedValue([{ id: DRAFT_ID }])
  generateMorePairs.mockResolvedValue({
    data: [{ question: 'Neuve ?', answer: 'Oui.' }],
    usage: { inputTokens: 1, outputTokens: 1 },
  })
  const res = await caller().faqBuilder.generateMore({ draftId: DRAFT_ID })
  expect(generateMorePairs).toHaveBeenCalledWith(expect.anything(), 'doc', ['Q ?'])
  expect(res.added).toBe(1)
  expect(res.items).toHaveLength(2)
  expect(res.items[1]).toMatchObject({ question: 'Neuve ?', origin: 'generated' })
})

test('generateMore sans clé API → PRECONDITION_FAILED ; échec Claude → BAD_GATEWAY', async () => {
  delete process.env.ANTHROPIC_API_KEY
  await expect(caller().faqBuilder.generateMore({ draftId: DRAFT_ID })).rejects.toMatchObject(
    { code: 'PRECONDITION_FAILED' },
  )
  process.env.ANTHROPIC_API_KEY = 'test-key'
  selectWhere.mockResolvedValue([{ id: DRAFT_ID, sourceText: 'doc', items: [] }])
  generateMorePairs.mockRejectedValue(new Error('boom'))
  await expect(caller().faqBuilder.generateMore({ draftId: DRAFT_ID })).rejects.toMatchObject(
    { code: 'BAD_GATEWAY' },
  )
})

test('delete inconnu → NOT_FOUND', async () => {
  deleteReturning.mockResolvedValue([])
  await expect(caller().faqBuilder.delete({ id: DRAFT_ID })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
})
```

- [ ] **Step 2: Run pour vérifier l'échec**

Run: `npx vitest run tests/server/admin-faq-builder.test.ts`
Expected: FAIL (`faqBuilder` absent du routeur admin).

- [ ] **Step 3: Créer `src/server/trpc/routers/admin-faq-builder.ts`**

```ts
import { randomUUID } from 'node:crypto'

import { TRPCError } from '@trpc/server'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { faqDrafts } from '@/server/db/schema'
import { faqItemSchema, type FaqItem } from '@/lib/faq/types'
import { createAnthropicClient } from '@/server/claude-core'
import { generateMorePairs } from '@/server/faq/claude'
import { adminProcedure, router } from '../trpc'

/**
 * FAQ builder drafts: list/edit/extend/delete. The initial generation lives
 * in POST /api/admin/faq-builder (multipart upload — out of tRPC's reach).
 */
export const faqBuilderRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: faqDrafts.id,
        sourceFilename: faqDrafts.sourceFilename,
        items: faqDrafts.items,
        updatedAt: faqDrafts.updatedAt,
      })
      .from(faqDrafts)
      .orderBy(desc(faqDrafts.updatedAt))
    return rows.map((r) => ({
      id: r.id,
      sourceFilename: r.sourceFilename,
      itemCount: r.items.length,
      updatedAt: r.updatedAt,
    }))
  }),

  get: adminProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    // sourceText is intentionally NOT selected (can be hundreds of kB).
    const [row] = await ctx.db
      .select({
        id: faqDrafts.id,
        sourceFilename: faqDrafts.sourceFilename,
        items: faqDrafts.items,
        updatedAt: faqDrafts.updatedAt,
      })
      .from(faqDrafts)
      .where(eq(faqDrafts.id, input.id))
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
    return row
  }),

  updateItems: adminProcedure
    .input(z.object({ id: z.uuid(), items: z.array(faqItemSchema).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(faqDrafts)
        .set({ items: input.items, updatedAt: new Date() })
        .where(eq(faqDrafts.id, input.id))
        .returning({ id: faqDrafts.id })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      return { ok: true }
    }),

  generateMore: adminProcedure
    .input(z.object({ draftId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'anthropic_not_configured' })
      }
      const [draft] = await ctx.db
        .select({
          id: faqDrafts.id,
          sourceText: faqDrafts.sourceText,
          items: faqDrafts.items,
        })
        .from(faqDrafts)
        .where(eq(faqDrafts.id, input.draftId))
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND' })

      let pairs
      try {
        pairs = (
          await generateMorePairs(
            createAnthropicClient(),
            draft.sourceText,
            draft.items.map((i) => i.question),
          )
        ).data
      } catch (err) {
        console.error('[faq-builder] generateMore failed:', err)
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'generation_failed' })
      }

      const added: FaqItem[] = pairs.map((p) => ({
        id: randomUUID(),
        question: p.question,
        answer: p.answer,
        origin: 'generated',
      }))
      const items = [...draft.items, ...added]
      const [row] = await ctx.db
        .update(faqDrafts)
        .set({ items, updatedAt: new Date() })
        .where(eq(faqDrafts.id, input.draftId))
        .returning({ id: faqDrafts.id })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      return { added: added.length, items }
    }),

  delete: adminProcedure.input(z.object({ id: z.uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .delete(faqDrafts)
      .where(eq(faqDrafts.id, input.id))
      .returning({ id: faqDrafts.id })
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
    return { ok: true }
  }),
})
```

- [ ] **Step 4: Enregistrer dans `src/server/trpc/routers/admin.ts`**

Près de la ligne 36 (`import { faqGapsRouter } from './admin-faq-gaps'`), ajouter :

```ts
import { faqBuilderRouter } from './admin-faq-builder'
```

Dans `adminRouter` (lignes 475-482), ajouter :

```ts
  faqBuilder: faqBuilderRouter,
```

- [ ] **Step 5: Vérifier vert + qualité**

Run: `npx vitest run tests/server/admin-faq-builder.test.ts && npm run typecheck && npm run lint`
Expected: 8 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/admin-faq-builder.ts src/server/trpc/routers/admin.ts tests/server/admin-faq-builder.test.ts
git commit -m "feat(faq-builder): tRPC draft CRUD and generate-more"
```

---

### Task 8: Export CSV Q&A Dify

**Files:**
- Create: `src/lib/admin/faq-csv.ts`
- Test: `tests/lib/faq-csv.test.ts`

- [ ] **Step 1: Écrire les tests (rouges)**

`tests/lib/faq-csv.test.ts` :

```ts
import { expect, test } from 'vitest'

import { buildFaqCsv } from '@/lib/admin/faq-csv'

test('en-tête question,answer + une ligne par paire, CRLF', () => {
  const csv = buildFaqCsv([{ question: 'Q1 ?', answer: 'R1.' }])
  expect(csv).toBe('question,answer\r\nQ1 ?,R1.\r\n')
})

test('RFC 4180 : virgule, guillemets et retours ligne → champ quoté, " doublé', () => {
  const csv = buildFaqCsv([
    { question: 'Avant, après ?', answer: 'Dit "oui"\nsur deux lignes' },
  ])
  expect(csv).toBe('question,answer\r\n"Avant, après ?","Dit ""oui""\nsur deux lignes"\r\n')
})

test('pas de garde anti-formule : un = de tête reste intact (ingestion Dify, pas Excel)', () => {
  const csv = buildFaqCsv([{ question: '=A1 ?', answer: '=somme' }])
  expect(csv).toContain('=A1 ?,=somme')
})
```

- [ ] **Step 2: Run pour vérifier l'échec**

Run: `npx vitest run tests/lib/faq-csv.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Créer `src/lib/admin/faq-csv.ts`**

```ts
/**
 * RFC 4180 CSV for the Dify Q&A import (comma-separated, UTF-8, CRLF).
 * NO BOM and NO Excel formula guard on purpose: this file is machine-ingested
 * by Dify (Knowledge → Import → Q&A mode), never opened in a spreadsheet —
 * prefixing values would pollute the indexed content. (The faq-gaps export
 * keeps the opposite convention: `;` + BOM, Excel-bound.)
 */

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"'
  return value
}

export function buildFaqCsv(
  items: ReadonlyArray<{ question: string; answer: string }>,
): string {
  const lines = ['question,answer']
  for (const it of items) lines.push(`${csvField(it.question)},${csvField(it.answer)}`)
  return lines.join('\r\n') + '\r\n'
}
```

- [ ] **Step 4: Vérifier vert + qualité**

Run: `npx vitest run tests/lib/faq-csv.test.ts && npm run typecheck && npm run lint`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/faq-csv.ts tests/lib/faq-csv.test.ts
git commit -m "feat(faq-builder): RFC 4180 CSV builder for the Dify Q&A import"
```

---

### Task 9: Page liste + upload (`/admin/faq-builder`)

**Files:**
- Create: `src/components/admin/FaqBuilderAdmin.tsx`
- Create: `src/app/admin/faq-builder/page.tsx`
- Test: `tests/components/FaqBuilderAdmin.test.tsx`

- [ ] **Step 1: Écrire les tests (rouges)**

`tests/components/FaqBuilderAdmin.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const listQuery = vi.hoisted(() => vi.fn())
const deleteMutate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    admin: {
      faqBuilder: {
        list: { useQuery: listQuery },
        delete: { useMutation: () => ({ mutate: deleteMutate, isPending: false }) },
      },
    },
    useUtils: () => ({ admin: { faqBuilder: { list: { invalidate: vi.fn() } } } }),
  },
}))

import { FaqBuilderAdmin } from '@/components/admin/FaqBuilderAdmin'

beforeEach(() => {
  vi.clearAllMocks()
  listQuery.mockReturnValue({
    data: [
      {
        id: 'd1',
        sourceFilename: 'guide.pdf',
        itemCount: 12,
        updatedAt: new Date('2026-06-10T10:00:00Z'),
      },
    ],
    isLoading: false,
    isError: false,
  })
})

test('liste les brouillons avec nom, compteur et lien éditeur', () => {
  render(<FaqBuilderAdmin />)
  expect(screen.getByText('guide.pdf')).toBeInTheDocument()
  expect(screen.getByText(/12 paires/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /ouvrir/i })).toHaveAttribute(
    'href',
    '/admin/faq-builder/d1',
  )
})

test('upload réussi → redirige vers l’éditeur du brouillon créé', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ id: 'new-draft', count: 9 }),
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<FaqBuilderAdmin />)
  const file = new File(['%PDF-fake'], 'doc.pdf', { type: 'application/pdf' })
  await userEvent.upload(screen.getByLabelText(/document source/i), file)
  await userEvent.click(screen.getByRole('button', { name: /générer la faq/i }))
  await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/admin/faq-builder/new-draft'))
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/admin/faq-builder',
    expect.objectContaining({ method: 'POST' }),
  )
  vi.unstubAllGlobals()
})

test('erreur serveur → bannière en français', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'empty_text' }),
    }),
  )
  render(<FaqBuilderAdmin />)
  const file = new File(['%PDF-fake'], 'doc.pdf', { type: 'application/pdf' })
  await userEvent.upload(screen.getByLabelText(/document source/i), file)
  await userEvent.click(screen.getByRole('button', { name: /générer la faq/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/scanné/i)
  vi.unstubAllGlobals()
})
```

- [ ] **Step 2: Run pour vérifier l'échec**

Run: `npx vitest run tests/components/FaqBuilderAdmin.test.tsx`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Créer `src/components/admin/FaqBuilderAdmin.tsx`**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { trpc } from '@/lib/trpc/client'

const ERROR_MESSAGES: Record<string, string> = {
  empty_text:
    'Aucun texte exploitable dans ce document — il est probablement scanné. ' +
    "Vérifiez le verdict OCR dans le Labo d'embed.",
  unreadable_document: 'Document illisible — protégé ou corrompu.',
  invalid_type: 'Format non pris en charge : PDF ou .docx uniquement.',
  file_too_large: 'Fichier trop volumineux (25 Mo max).',
  anthropic_not_configured: "Clé Anthropic absente — configurez ANTHROPIC_API_KEY.",
  generation_failed: 'La génération a échoué. Réessayez.',
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('fr-FR')
}

export function FaqBuilderAdmin() {
  const router = useRouter()
  const utils = trpc.useUtils()
  const list = trpc.admin.faqBuilder.list.useQuery()
  const del = trpc.admin.faqBuilder.delete.useMutation({
    onSuccess: () => utils.admin.faqBuilder.list.invalidate(),
  })

  const [file, setFile] = useState<File | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    if (!file) return
    setGenerating(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      const res = await fetch('/api/admin/faq-builder', { method: 'POST', body: form })
      const body = (await res.json()) as { id?: string; error?: string }
      if (!res.ok || !body.id) {
        setError(ERROR_MESSAGES[body.error ?? ''] ?? 'Erreur inattendue. Réessayez.')
        return
      }
      router.push(`/admin/faq-builder/${body.id}`)
    } catch {
      setError('Erreur réseau. Réessayez.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-[14px] border border-line bg-card p-5">
        <h2 className="text-[15px] font-semibold text-ink">Nouveau document</h2>
        <p className="mt-1 text-[13px] text-sub">
          PDF ou .docx, 25 Mo max. La génération prend 30 à 60 secondes
          (Claude Sonnet 4.6).
        </p>
        <div className="mt-3 flex items-center gap-3">
          <label className="text-[13px] text-ink">
            <span className="sr-only">Document source</span>
            <input
              type="file"
              accept=".pdf,.docx"
              aria-label="Document source"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-[13px]"
            />
          </label>
          <button
            type="button"
            onClick={generate}
            disabled={!file || generating}
            className="rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {generating ? 'Génération en cours…' : 'Générer la FAQ'}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-red">
            {error}
          </p>
        )}
      </div>

      {list.isLoading && <p className="text-[14px] text-sub">Chargement…</p>}
      {list.isError && <p className="text-[14px] text-red">{list.error.message}</p>}
      {list.data && list.data.length === 0 && (
        <p className="text-[14px] text-sub">Aucun brouillon — uploadez un document.</p>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="space-y-2">
          {list.data.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between rounded-[14px] border border-line bg-card px-4 py-3"
            >
              <div>
                <p className="text-[14px] font-medium text-ink">{d.sourceFilename}</p>
                <p className="text-[12.5px] text-faint">
                  {d.itemCount} paires · modifié le {formatDate(d.updatedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/faq-builder/${d.id}`}
                  className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink"
                >
                  Ouvrir
                </Link>
                <button
                  type="button"
                  onClick={() => del.mutate({ id: d.id })}
                  className="rounded-lg px-2 py-1.5 text-[13px] text-red"
                  aria-label={`Supprimer ${d.sourceFilename}`}
                >
                  Supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Créer `src/app/admin/faq-builder/page.tsx`**

```tsx
import { FaqBuilderAdmin } from '@/components/admin/FaqBuilderAdmin'

export default function AdminFaqBuilderPage() {
  return (
    <div>
      <h1 className="font-serif text-[30px] font-medium tracking-[-0.02em]">
        FAQ Builder
      </h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Générez une FAQ depuis un document, retouchez les paires, puis exportez
        le CSV à importer dans Dify (Connaissances → Importer → mode Q&amp;A).
      </p>
      <FaqBuilderAdmin />
    </div>
  )
}
```

- [ ] **Step 5: Vérifier vert + qualité**

Run: `npx vitest run tests/components/FaqBuilderAdmin.test.tsx && npm run typecheck && npm run lint`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/FaqBuilderAdmin.tsx src/app/admin/faq-builder/page.tsx tests/components/FaqBuilderAdmin.test.tsx
git commit -m "feat(faq-builder): drafts list page with upload-and-generate"
```

---

### Task 10: Éditeur (`/admin/faq-builder/[id]`)

**Files:**
- Create: `src/components/admin/FaqDraftEditor.tsx`
- Create: `src/app/admin/faq-builder/[id]/page.tsx`
- Test: `tests/components/FaqDraftEditor.test.tsx`

- [ ] **Step 1: Écrire les tests (rouges)**

`tests/components/FaqDraftEditor.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

const getQuery = vi.hoisted(() => vi.fn())
const updateMutate = vi.hoisted(() => vi.fn())
const generateMoreMutate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    admin: {
      faqBuilder: {
        get: { useQuery: getQuery },
        updateItems: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
        generateMore: {
          useMutation: () => ({ mutate: generateMoreMutate, isPending: false }),
        },
      },
    },
    useUtils: () => ({ admin: { faqBuilder: { get: { invalidate: vi.fn() } } } }),
  },
}))

const downloadCsv = vi.hoisted(() => vi.fn())
vi.mock('@/lib/admin/download-csv', () => ({ downloadCsv }))

import { FaqDraftEditor } from '@/components/admin/FaqDraftEditor'

const DRAFT = {
  id: 'd1',
  sourceFilename: 'guide.pdf',
  updatedAt: new Date('2026-06-10T10:00:00Z'),
  items: [
    { id: 'i1', question: 'Q1 ?', answer: 'R1.', origin: 'generated' as const },
    { id: 'i2', question: 'Q2 ?', answer: 'R2.', origin: 'manual' as const },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  getQuery.mockReturnValue({ data: DRAFT, isLoading: false, isError: false })
})

test('affiche les paires avec badges origine et compteur', () => {
  render(<FaqDraftEditor draftId="d1" />)
  expect(screen.getByDisplayValue('Q1 ?')).toBeInTheDocument()
  expect(screen.getByDisplayValue('R2.')).toBeInTheDocument()
  expect(screen.getByText(/2 paires/)).toBeInTheDocument()
  expect(screen.getByText('générée')).toBeInTheDocument()
  expect(screen.getByText('manuelle')).toBeInTheDocument()
})

test('éditer une question rend le brouillon dirty : Enregistrer activé, Exporter et Générer plus désactivés', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  expect(screen.getByRole('button', { name: /enregistrer/i })).toBeDisabled()
  await userEvent.type(screen.getByDisplayValue('Q1 ?'), ' bis')
  expect(screen.getByRole('button', { name: /enregistrer/i })).toBeEnabled()
  expect(screen.getByRole('button', { name: /exporter csv/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /générer plus/i })).toBeDisabled()
})

test('Enregistrer envoie la liste éditée', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.type(screen.getByDisplayValue('Q1 ?'), ' bis')
  await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }))
  expect(updateMutate).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'd1',
      items: expect.arrayContaining([expect.objectContaining({ question: 'Q1 ? bis' })]),
    }),
    expect.anything(),
  )
})

test('Ajouter une paire crée un item manuel vide, Enregistrer bloqué tant que vide', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.click(screen.getByRole('button', { name: /ajouter une paire/i }))
  expect(screen.getByText(/3 paires/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /enregistrer/i })).toBeDisabled()
  expect(screen.getByText(/champs vides/i)).toBeInTheDocument()
})

test('Supprimer retire la paire ; Descendre permute', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.click(screen.getAllByRole('button', { name: /supprimer la paire/i })[0])
  expect(screen.queryByDisplayValue('Q1 ?')).not.toBeInTheDocument()
})

test('Exporter CSV (état propre) télécharge faq-<slug>-<date>.csv', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.click(screen.getByRole('button', { name: /exporter csv/i }))
  expect(downloadCsv).toHaveBeenCalledWith(
    expect.stringMatching(/^faq-guide-pdf-\d{4}-\d{2}-\d{2}\.csv$/),
    expect.stringContaining('question,answer'),
  )
})

test('Générer plus (état propre) appelle la mutation', async () => {
  render(<FaqDraftEditor draftId="d1" />)
  await userEvent.click(screen.getByRole('button', { name: /générer plus/i }))
  expect(generateMoreMutate).toHaveBeenCalledWith({ draftId: 'd1' }, expect.anything())
})
```

- [ ] **Step 2: Run pour vérifier l'échec**

Run: `npx vitest run tests/components/FaqDraftEditor.test.tsx`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Créer `src/components/admin/FaqDraftEditor.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'

import { trpc } from '@/lib/trpc/client'
import { buildFaqCsv } from '@/lib/admin/faq-csv'
import { downloadCsv } from '@/lib/admin/download-csv'
import { slugify } from '@/lib/slug'
import type { FaqItem } from '@/lib/faq/types'

const FIELD =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink'

export function FaqDraftEditor({ draftId }: { draftId: string }) {
  const utils = trpc.useUtils()
  const draft = trpc.admin.faqBuilder.get.useQuery({ id: draftId })
  const update = trpc.admin.faqBuilder.updateItems.useMutation()
  const generateMore = trpc.admin.faqBuilder.generateMore.useMutation()

  const [items, setItems] = useState<FaqItem[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  // Hydrate local state once from the server payload (then local state wins).
  useEffect(() => {
    if (draft.data && items === null) setItems(draft.data.items)
  }, [draft.data, items])

  // Block accidental tab close while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  if (draft.isLoading || items === null) {
    return <p className="mt-6 text-[14px] text-sub">Chargement…</p>
  }
  if (draft.isError) {
    return <p className="mt-6 text-[14px] text-red">{draft.error.message}</p>
  }

  const hasEmpty = items.some((it) => !it.question.trim() || !it.answer.trim())

  const edit = (id: string, patch: Partial<Pick<FaqItem, 'question' | 'answer'>>) => {
    setItems((prev) => prev!.map((it) => (it.id === id ? { ...it, ...patch } : it)))
    setDirty(true)
  }
  const remove = (id: string) => {
    setItems((prev) => prev!.filter((it) => it.id !== id))
    setDirty(true)
  }
  const move = (index: number, delta: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev!]
      const j = index + delta
      if (j < 0 || j >= next.length) return next
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
    setDirty(true)
  }
  const addPair = () => {
    setItems((prev) => [
      ...prev!,
      { id: crypto.randomUUID(), question: '', answer: '', origin: 'manual' },
    ])
    setDirty(true)
  }

  const save = () => {
    setBanner(null)
    update.mutate(
      { id: draftId, items: items },
      {
        onSuccess: () => {
          setDirty(false)
          setBanner('Brouillon enregistré.')
          utils.admin.faqBuilder.get.invalidate({ id: draftId })
        },
        onError: () => setBanner("L'enregistrement a échoué. Réessayez."),
      },
    )
  }

  const more = () => {
    setBanner(null)
    generateMore.mutate(
      { draftId },
      {
        onSuccess: (res) => {
          setItems(res.items)
          setDirty(false)
          setBanner(`${res.added} paire${res.added > 1 ? 's' : ''} ajoutée${res.added > 1 ? 's' : ''}.`)
          utils.admin.faqBuilder.get.invalidate({ id: draftId })
        },
        onError: () => setBanner('La génération a échoué. Réessayez.'),
      },
    )
  }

  const exportCsv = () => {
    const csv = buildFaqCsv(items)
    const date = new Date().toISOString().slice(0, 10)
    downloadCsv(`faq-${slugify(draft.data!.sourceFilename)}-${date}.csv`, csv)
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-sub">
          {items.length} paire{items.length > 1 ? 's' : ''} — {draft.data!.sourceFilename}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addPair}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink"
          >
            Ajouter une paire
          </button>
          <button
            type="button"
            onClick={more}
            disabled={dirty || generateMore.isPending}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink disabled:opacity-50"
          >
            {generateMore.isPending ? 'Génération…' : 'Générer plus'}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || hasEmpty || update.isPending}
            className="rounded-lg bg-red px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={dirty || items.length === 0}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink disabled:opacity-50"
          >
            Exporter CSV
          </button>
        </div>
      </div>

      {hasEmpty && (
        <p className="text-[13px] text-red">
          Des paires ont des champs vides — complétez-les ou supprimez-les avant
          d&apos;enregistrer.
        </p>
      )}
      {dirty && (
        <p className="text-[13px] text-faint">
          Modifications non enregistrées — « Générer plus » et l&apos;export sont
          désactivés tant que le brouillon n&apos;est pas enregistré.
        </p>
      )}
      {banner && (
        <p role="status" className="text-[13px] text-sub">
          {banner}
        </p>
      )}

      <ul className="space-y-3">
        {items.map((it, index) => (
          <li key={it.id} className="rounded-[14px] border border-line bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="rounded-full bg-surface px-2 py-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
                {it.origin === 'generated' ? 'générée' : 'manuelle'}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Monter la paire ${index + 1}`}
                  className="rounded px-2 py-1 text-[13px] text-sub disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                  aria-label={`Descendre la paire ${index + 1}`}
                  className="rounded px-2 py-1 text-[13px] text-sub disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(it.id)}
                  aria-label={`Supprimer la paire ${index + 1}`}
                  className="rounded px-2 py-1 text-[13px] text-red"
                >
                  Supprimer
                </button>
              </div>
            </div>
            <label className="block text-[12.5px] font-semibold text-faint">
              Question
              <textarea
                value={it.question}
                onChange={(e) => edit(it.id, { question: e.target.value })}
                rows={2}
                className={`${FIELD} mt-1`}
              />
            </label>
            <label className="mt-3 block text-[12.5px] font-semibold text-faint">
              Réponse
              <textarea
                value={it.answer}
                onChange={(e) => edit(it.id, { answer: e.target.value })}
                rows={4}
                className={`${FIELD} mt-1`}
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Créer `src/app/admin/faq-builder/[id]/page.tsx`**

```tsx
import { FaqDraftEditor } from '@/components/admin/FaqDraftEditor'

export default async function AdminFaqDraftPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div>
      <h1 className="font-serif text-[30px] font-medium tracking-[-0.02em]">
        Édition de la FAQ
      </h1>
      <p className="mt-3 text-[14.5px] text-sub">
        Retouchez les paires puis exportez le CSV — import Dify : Connaissances →
        Importer → mode Q&amp;A.
      </p>
      <FaqDraftEditor draftId={id} />
    </div>
  )
}
```

(Next 16 App Router : `params` est une Promise — suivre le pattern des pages dynamiques existantes, ex. `src/app/admin/actualites/[id]/page.tsx`.)

- [ ] **Step 5: Vérifier vert + qualité**

Run: `npx vitest run tests/components/FaqDraftEditor.test.tsx && npm run typecheck && npm run lint`
Expected: 7 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/FaqDraftEditor.tsx src/app/admin/faq-builder/[id]/page.tsx tests/components/FaqDraftEditor.test.tsx
git commit -m "feat(faq-builder): persistent draft editor with CSV export"
```

---

### Task 11: Nav admin + suite complète

**Files:**
- Modify: `src/components/admin/AdminNav.tsx:8-16`

- [ ] **Step 1: Ajouter l'entrée nav**

Dans `NAV_ITEMS` de `src/components/admin/AdminNav.tsx`, après la ligne `['/admin/faq-gaps', 'Trous FAQ', 'search'],` :

```ts
  ['/admin/faq-builder', 'FAQ Builder', 'book'],
```

(`'book'` est un nom d'icône déjà utilisé par Formations — vérifier dans `src/components/ui/Icon.tsx` qu'il existe ; sinon prendre un nom existant pertinent.)

- [ ] **Step 2: Suite complète + qualité**

Run: `npm test && npm run typecheck && npm run lint`
Expected: ~415 tests PASS (381 + ~34 nouveaux), tsc 0 erreur, lint 0 warning.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/AdminNav.tsx
git commit -m "feat(faq-builder): admin nav entry"
```

---

### Task 12: Smoke test manuel, PR, CI, merge

- [ ] **Step 1: Smoke test local (optionnel mais recommandé : un PDF réel)**

Run: `npm run dev` puis se connecter admin@aps.fr/admin1234, ouvrir `/admin/faq-builder`, uploader un petit PDF texte, vérifier : génération → éditeur → édition + save → générer plus → export CSV ouvert dans un éditeur de texte (en-tête `question,answer`, quoting correct). Nécessite `ANTHROPIC_API_KEY` dans `.env` local.

- [ ] **Step 2: Push + PR**

```bash
git push -u origin feat/faq-builder
gh pr create --title "feat: admin FAQ builder (generate, edit, export Dify Q&A CSV)" --body "Spec: docs/superpowers/specs/2026-06-10-faq-builder-design.md. Generation route (PDF/.docx -> Sonnet 4.6 forced tool use -> faq_drafts), tRPC draft CRUD + generate-more with code dedup, persistent editor, RFC 4180 CSV export for Dify Q&A import. Migration 0007 additive at boot."
```

- [ ] **Step 3: CI verte puis merge**

Run: `gh pr checks --watch`
Expected: check `checks` SUCCESS (rappel : ne JAMAIS merger rouge). Puis :

```bash
gh pr merge --squash --delete-branch
```

⚠️ Au déploiement : migration 0007 s'applique au boot Dokploy (auto-deploy au merge). `ANTHROPIC_API_KEY` est déjà posée dans l'UI Dokploy (labo d'embed) — rien à faire côté env.
