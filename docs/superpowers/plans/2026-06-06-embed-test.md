# Labo d'embed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-only bench tool at `/admin/embed-test`: upload a PDF, Claude tests several Dify ingestion configurations (OCR vs text extraction, chunk size/overlap/separator, General vs Parent-child) and produces a recommendation the admin applies manually in the Dify UI. **No formaps→Dify API connection.**

**Architecture:** Route handler `POST /api/admin/embed-test` (multipart ≤25 MB, admin guard, SSE progress stream — assembly of the two proven prod patterns: documents upload route + brain SSE route). Server pipeline: extract text (`unpdf`) → OCR verdict (Claude vision on 5 sampled pages vs native text) → Claude proposes 4-6 configs → local chunking simulation (`gpt-tokenizer`, pure) → Claude judges each config → ephemeral report. Client: hook `useEmbedTest` (same stream mechanics as `useBrainChat`) + `EmbedTestAdmin` component.

**Tech Stack:** Next.js 16 App Router, `@anthropic-ai/sdk` (forced tool use for structured outputs, models `claude-sonnet-4-6` default / `claude-opus-4-8`), `unpdf`, `pdf-lib` (page sampling), `gpt-tokenizer` (Dify-family token counting — correct here because we simulate Dify's chunker, NOT Claude tokens), zod v4, vitest.

**Conventions repo (lire avant de coder):** `AGENTS.md` exige de lire `node_modules/next/dist/docs/` pour toute API Next inconnue. Routes API se gardent elles-mêmes (middleware exclut `/api`). Tests dans `tests/lib/` et `tests/server/`, env jsdom global, mocks `vi.mock('@/server/auth')` comme `tests/server/upload-route.test.ts`. Réponses UI en français, code/commits en anglais.

**Spec:** `docs/superpowers/specs/2026-06-06-embed-test-design.md`

---

### Task 1: Dependencies + env plumbing

**Files:**
- Modify: `package.json` (via pnpm/npm install)
- Modify: `.env.example`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Install dependencies**

```powershell
cd C:\Users\mathi\formaps
npm install @anthropic-ai/sdk unpdf pdf-lib gpt-tokenizer
```

Expected: 4 packages added to `dependencies` in package.json.

- [ ] **Step 2: Add env var to `.env.example`**

Append after the DIFY block (lines 11-12):

```bash
# Claude API (labo d'embed admin) — facturé à l'usage, clé séparée de Dify
ANTHROPIC_API_KEY=
```

- [ ] **Step 3: Add env var to `docker-compose.yml`**

In the `web` service `environment:` block (next to `DIFY_API_URL`/`DIFY_API_KEY` lines 33-34), add:

```yaml
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
```

(Default empty: the feature degrades to 503 with a clear message, never blocks boot.)

- [ ] **Step 4: Verify the suite still passes**

Run: `npm test`
Expected: all existing tests PASS (200 tests).

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json .env.example docker-compose.yml
git commit -m "chore(embed-test): add anthropic sdk, unpdf, pdf-lib, gpt-tokenizer + ANTHROPIC_API_KEY plumbing"
```

---

### Task 2: Shared types + config schema (`types.ts`)

**Files:**
- Create: `src/lib/embed-test/types.ts`
- Test: `tests/lib/embed-test-types.test.ts`

Pure module, shared server + client (NO node imports — same rule as `src/lib/dify/parse.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/embed-test-types.test.ts
import { describe, expect, test } from 'vitest'

import { chunkConfigSchema } from '@/lib/embed-test/types'

const valid = {
  label: 'Standard 1024',
  mode: 'general',
  separator: '\\n\\n',
  maxTokens: 1024,
  overlapTokens: 128,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
}

describe('chunkConfigSchema', () => {
  test('accepts a valid general config', () => {
    expect(chunkConfigSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects overlap >= maxTokens', () => {
    expect(
      chunkConfigSchema.safeParse({ ...valid, overlapTokens: 1024 }).success,
    ).toBe(false)
  })

  test('rejects maxTokens out of Dify bounds', () => {
    expect(chunkConfigSchema.safeParse({ ...valid, maxTokens: 50 }).success).toBe(false)
    expect(chunkConfigSchema.safeParse({ ...valid, maxTokens: 5000 }).success).toBe(false)
  })

  test('parent-child requires parent/child token sizes', () => {
    expect(
      chunkConfigSchema.safeParse({ ...valid, mode: 'parent-child' }).success,
    ).toBe(false)
    expect(
      chunkConfigSchema.safeParse({
        ...valid,
        mode: 'parent-child',
        parentMaxTokens: 2000,
        childMaxTokens: 400,
      }).success,
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/embed-test-types.test.ts`
Expected: FAIL — cannot resolve `@/lib/embed-test/types`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/embed-test/types.ts
/**
 * Shared types for the embed-test lab. Pure module (no node/server imports) —
 * used by the server pipeline AND the client hook, same rule as lib/dify/parse.
 *
 * ChunkConfig mirrors the knobs exposed by the Dify Knowledge UI so the final
 * recommendation maps 1:1 to what the admin sets manually in Dify.
 */
import { z } from 'zod'

export const EMBED_TEST_MODEL_KEYS = ['sonnet', 'opus'] as const
export type EmbedTestModelKey = (typeof EMBED_TEST_MODEL_KEYS)[number]

export const chunkConfigSchema = z
  .object({
    label: z.string().min(1).max(80),
    mode: z.enum(['general', 'parent-child']),
    /** Literal separator; Claude may send escaped forms like "\\n\\n". */
    separator: z.string().min(1).max(20),
    /** Dify UI: "Maximum chunk length" (tokens). */
    maxTokens: z.number().int().min(100).max(4000),
    /** Dify UI: "Chunk overlap" (tokens). */
    overlapTokens: z.number().int().min(0).max(2000),
    parentMaxTokens: z.number().int().min(200).max(8000).optional(),
    childMaxTokens: z.number().int().min(50).max(2000).optional(),
    preprocessing: z.object({
      removeExtraSpaces: z.boolean(),
      removeUrlsEmails: z.boolean(),
    }),
    rationale: z.string().max(500).optional(),
  })
  .refine((c) => c.overlapTokens < c.maxTokens, {
    message: 'overlapTokens must be < maxTokens',
  })
  .refine(
    (c) =>
      c.mode === 'general' ||
      (c.parentMaxTokens !== undefined && c.childMaxTokens !== undefined),
    { message: 'parent-child mode requires parentMaxTokens and childMaxTokens' },
  )

export type ChunkConfig = z.infer<typeof chunkConfigSchema>

export type OcrVerdict = {
  verdict: 'text_ok' | 'ocr_needed'
  reason: string
  /** 0..1 — fraction of visually-read content present in the native text layer. */
  coverage: number
}

export type ConfigResult = {
  index: number
  score: number
  issues: string[]
  summary: string
  chunkCount: number
  failed?: boolean
}

export type EmbedTestReport = {
  ocr: OcrVerdict
  /** Config indices sorted best-first (failed configs excluded). */
  ranking: number[]
  recommendation: { configIndex: number; difySettings: string; rationale: string }
  usage: { inputTokens: number; outputTokens: number }
}

export type EmbedTestEvent =
  | { type: 'step'; id: string; label: string }
  | { type: 'configs'; items: ChunkConfig[] }
  | { type: 'config-result'; result: ConfigResult }
  | { type: 'report'; report: EmbedTestReport }
  | { type: 'error'; code: string; message: string }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/embed-test-types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/lib/embed-test/types.ts tests/lib/embed-test-types.test.ts
git commit -m "feat(embed-test): shared types + Dify-aligned chunk config schema"
```

---

### Task 3: Chunker — preprocess + general mode (`chunker.ts`)

**Files:**
- Create: `src/lib/embed-test/chunker.ts`
- Test: `tests/lib/embed-test-chunker.test.ts`

Pure simulation of Dify's General chunking: separator split → merge/split to `maxTokens` → prepend `overlapTokens` tail of previous chunk. Token counting via `gpt-tokenizer` (same tokenizer family Dify uses for "max chunk length" — this is intentionally NOT a Claude tokenizer).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/embed-test-chunker.test.ts
import { describe, expect, test } from 'vitest'

import {
  chunkDocument,
  countTokens,
  normalizeSeparator,
  preprocess,
} from '@/lib/embed-test/chunker'
import type { ChunkConfig } from '@/lib/embed-test/types'

const base: ChunkConfig = {
  label: 't',
  mode: 'general',
  separator: '\\n\\n',
  maxTokens: 100,
  overlapTokens: 0,
  preprocessing: { removeExtraSpaces: false, removeUrlsEmails: false },
}

describe('normalizeSeparator', () => {
  test('unescapes \\n and \\t', () => {
    expect(normalizeSeparator('\\n\\n')).toBe('\n\n')
    expect(normalizeSeparator('\\t')).toBe('\t')
    expect(normalizeSeparator('###')).toBe('###')
  })
})

describe('preprocess', () => {
  test('removeExtraSpaces collapses runs of spaces/tabs and 3+ newlines', () => {
    const out = preprocess('a   b\t\tc\n\n\n\nd', {
      removeExtraSpaces: true,
      removeUrlsEmails: false,
    })
    expect(out).toBe('a b c\n\nd')
  })

  test('removeUrlsEmails strips URLs and emails', () => {
    const out = preprocess('voir https://exemple.fr/page et jean@aps.fr merci', {
      removeExtraSpaces: false,
      removeUrlsEmails: true,
    })
    expect(out).not.toContain('https://')
    expect(out).not.toContain('@')
    expect(out).toContain('voir')
    expect(out).toContain('merci')
  })
})

describe('chunkDocument — general', () => {
  test('empty text → no chunks', () => {
    expect(chunkDocument('', base)).toEqual([])
    expect(chunkDocument('   \n  ', base)).toEqual([])
  })

  test('short text → single chunk', () => {
    const chunks = chunkDocument('Bonjour le magasin.', base)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe('Bonjour le magasin.')
  })

  test('splits on separator and respects maxTokens', () => {
    const para = 'mot '.repeat(60).trim() // ~60 tokens
    const text = `${para}\n\n${para}\n\n${para}`
    const chunks = chunkDocument(text, { ...base, maxTokens: 80 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(countTokens(c.text)).toBeLessThanOrEqual(80)
    }
  })

  test('merges small paragraphs up to maxTokens', () => {
    const text = 'Un.\n\nDeux.\n\nTrois.'
    const chunks = chunkDocument(text, { ...base, maxTokens: 100 })
    expect(chunks).toHaveLength(1)
  })

  test('separator absent → falls back to token split', () => {
    const text = 'mot '.repeat(300).trim() // no \n\n anywhere
    const chunks = chunkDocument(text, { ...base, maxTokens: 100 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(countTokens(c.text)).toBeLessThanOrEqual(100)
    }
  })

  test('overlap prepends tail of previous chunk', () => {
    const para = 'alpha beta gamma delta epsilon zeta eta theta iota kappa'
    const text = `${para}\n\n${para}\n\n${para}`
    const noOverlap = chunkDocument(text, { ...base, maxTokens: 15, overlapTokens: 0 })
    const withOverlap = chunkDocument(text, { ...base, maxTokens: 15, overlapTokens: 5 })
    expect(withOverlap.length).toBe(noOverlap.length)
    // Every chunk after the first is strictly longer with overlap on.
    for (let i = 1; i < withOverlap.length; i++) {
      expect(withOverlap[i].text.length).toBeGreaterThan(noOverlap[i].text.length)
    }
    expect(withOverlap[0].text).toBe(noOverlap[0].text)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/embed-test-chunker.test.ts`
Expected: FAIL — cannot resolve `@/lib/embed-test/chunker`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/embed-test/chunker.ts
/**
 * Pure simulation of Dify's chunking so configs can be compared WITHOUT
 * touching the Dify instance. Token counting uses gpt-tokenizer (GPT-family),
 * matching how Dify measures "maximum chunk length" — deliberately NOT a
 * Claude tokenizer.
 */
import { decode, encode } from 'gpt-tokenizer'

import type { ChunkConfig } from '@/lib/embed-test/types'

export type Chunk = { text: string; parentText?: string }

export function countTokens(text: string): number {
  return encode(text).length
}

/** Claude proposes separators as escaped strings ("\\n\\n") — unescape them. */
export function normalizeSeparator(separator: string): string {
  return separator.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

export function preprocess(
  text: string,
  rules: ChunkConfig['preprocessing'],
): string {
  let out = text
  if (rules.removeUrlsEmails) {
    out = out
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '')
  }
  if (rules.removeExtraSpaces) {
    out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
  }
  return out.trim()
}

/** Hard token-window split for segments that exceed maxTokens on their own. */
function splitByTokens(text: string, maxTokens: number): string[] {
  const tokens = encode(text)
  const parts: string[] = []
  for (let i = 0; i < tokens.length; i += maxTokens) {
    const piece = decode(tokens.slice(i, i + maxTokens)).trim()
    if (piece) parts.push(piece)
  }
  return parts
}

/**
 * General-mode chunking: split on separator, merge consecutive segments while
 * they fit in maxTokens, token-split oversized segments, then prepend the
 * last `overlapTokens` tokens of the previous chunk.
 */
function chunkGeneral(
  text: string,
  separator: string,
  maxTokens: number,
  overlapTokens: number,
): string[] {
  const segments = (text.includes(separator) ? text.split(separator) : [text])
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const pieces: string[] = []
  for (const seg of segments) {
    if (countTokens(seg) <= maxTokens) pieces.push(seg)
    else pieces.push(...splitByTokens(seg, maxTokens))
  }

  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    const candidate = current ? current + separator + piece : piece
    if (countTokens(candidate) <= maxTokens) {
      current = candidate
    } else {
      if (current) chunks.push(current)
      current = piece
    }
  }
  if (current) chunks.push(current)

  if (overlapTokens <= 0 || chunks.length < 2) return chunks
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk
    const prevTokens = encode(chunks[i - 1])
    const tail = decode(prevTokens.slice(-overlapTokens)).trim()
    return tail ? `${tail} ${chunk}` : chunk
  })
}

/**
 * Chunks a document according to a (pre-validated) ChunkConfig.
 * Parent-child: parents split at parentMaxTokens (no overlap, like Dify),
 * children split inside each parent at childMaxTokens, carrying parentText.
 */
export function chunkDocument(text: string, config: ChunkConfig): Chunk[] {
  const cleaned = preprocess(text, config.preprocessing)
  if (!cleaned) return []
  const separator = normalizeSeparator(config.separator)

  if (config.mode === 'general') {
    return chunkGeneral(cleaned, separator, config.maxTokens, config.overlapTokens).map(
      (t) => ({ text: t }),
    )
  }

  // parent-child — schema guarantees both sizes are present
  const parents = chunkGeneral(cleaned, separator, config.parentMaxTokens!, 0)
  const out: Chunk[] = []
  for (const parent of parents) {
    for (const child of chunkGeneral(parent, separator, config.childMaxTokens!, 0)) {
      out.push({ text: child, parentText: parent })
    }
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/embed-test-chunker.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/lib/embed-test/chunker.ts tests/lib/embed-test-chunker.test.ts
git commit -m "feat(embed-test): pure Dify chunking simulation (general mode + preprocessing)"
```

---

### Task 4: Chunker — parent-child mode

**Files:**
- Modify: `src/lib/embed-test/chunker.ts` (already implemented in Task 3 — this task only adds the missing tests; if Task 3 was executed verbatim, Step 3 is a no-op)
- Test: `tests/lib/embed-test-chunker.test.ts`

- [ ] **Step 1: Write the failing/characterization tests**

Append to `tests/lib/embed-test-chunker.test.ts`:

```typescript
describe('chunkDocument — parent-child', () => {
  const pc: ChunkConfig = {
    ...base,
    mode: 'parent-child',
    parentMaxTokens: 60,
    childMaxTokens: 20,
  }

  test('children carry their parent text', () => {
    const para = 'alpha beta gamma delta epsilon zeta eta theta iota kappa'
    const text = `${para}\n\n${para}\n\n${para}\n\n${para}`
    const chunks = chunkDocument(text, pc)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.parentText).toBeDefined()
      expect(c.parentText).toContain(c.text.split(' ')[0])
      expect(countTokens(c.text)).toBeLessThanOrEqual(20)
      expect(countTokens(c.parentText!)).toBeLessThanOrEqual(60)
    }
  })

  test('every child belongs to exactly one parent', () => {
    const text = 'Un deux trois.\n\nQuatre cinq six.\n\nSept huit neuf.'
    const chunks = chunkDocument(text, pc)
    const parents = new Set(chunks.map((c) => c.parentText))
    expect(parents.size).toBeGreaterThanOrEqual(1)
    for (const c of chunks) expect(c.parentText).toContain(c.text)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/lib/embed-test-chunker.test.ts`
Expected: PASS if Task 3 implementation was complete (characterization); if FAIL, fix `chunkDocument` parent-child branch until green.

- [ ] **Step 3: Commit**

```powershell
git add tests/lib/embed-test-chunker.test.ts
git commit -m "test(embed-test): parent-child chunking coverage"
```

---

### Task 5: Client event parsing (`parse.ts`)

**Files:**
- Create: `src/lib/embed-test/parse.ts`
- Test: `tests/lib/embed-test-parse.test.ts`

Pure, client-safe. SSE line extraction reuses `parseSSELines` from `@/lib/dify/parse` — this module only validates the JSON payloads into `EmbedTestEvent`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/embed-test-parse.test.ts
import { describe, expect, test } from 'vitest'

import { parseEmbedTestEvent } from '@/lib/embed-test/parse'

describe('parseEmbedTestEvent', () => {
  test('parses a step event', () => {
    const ev = parseEmbedTestEvent(
      JSON.stringify({ type: 'step', id: 'extract', label: 'Extraction du texte…' }),
    )
    expect(ev).toEqual({ type: 'step', id: 'extract', label: 'Extraction du texte…' })
  })

  test('parses configs / config-result / report / error events', () => {
    const config = {
      label: 'c',
      mode: 'general',
      separator: '\\n\\n',
      maxTokens: 1024,
      overlapTokens: 0,
      preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
    }
    expect(
      parseEmbedTestEvent(JSON.stringify({ type: 'configs', items: [config] }))?.type,
    ).toBe('configs')
    expect(
      parseEmbedTestEvent(
        JSON.stringify({
          type: 'config-result',
          result: { index: 0, score: 7, issues: [], summary: 'ok', chunkCount: 12 },
        }),
      )?.type,
    ).toBe('config-result')
    expect(
      parseEmbedTestEvent(
        JSON.stringify({
          type: 'report',
          report: {
            ocr: { verdict: 'text_ok', reason: 'r', coverage: 0.98 },
            ranking: [0],
            recommendation: { configIndex: 0, difySettings: 's', rationale: 'r' },
            usage: { inputTokens: 1, outputTokens: 2 },
          },
        }),
      )?.type,
    ).toBe('report')
    expect(
      parseEmbedTestEvent(JSON.stringify({ type: 'error', code: 'x', message: 'm' }))
        ?.type,
    ).toBe('error')
  })

  test('returns null on invalid JSON, unknown type, or missing fields', () => {
    expect(parseEmbedTestEvent('{oops')).toBeNull()
    expect(parseEmbedTestEvent(JSON.stringify({ type: 'nope' }))).toBeNull()
    expect(parseEmbedTestEvent(JSON.stringify({ type: 'step' }))).toBeNull()
    expect(parseEmbedTestEvent(JSON.stringify(null))).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/embed-test-parse.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/embed-test/parse.ts
/**
 * Validates raw SSE JSON payloads from /api/admin/embed-test into typed
 * EmbedTestEvent objects. Pure and client-safe — same convention as
 * lib/dify/parse. Returns null on anything malformed (never throws).
 */
import { z } from 'zod'

import { chunkConfigSchema, type EmbedTestEvent } from '@/lib/embed-test/types'

const configResultSchema = z.object({
  index: z.number().int().min(0),
  score: z.number(),
  issues: z.array(z.string()),
  summary: z.string(),
  chunkCount: z.number().int().min(0),
  failed: z.boolean().optional(),
})

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('step'), id: z.string(), label: z.string() }),
  z.object({ type: z.literal('configs'), items: z.array(chunkConfigSchema) }),
  z.object({ type: z.literal('config-result'), result: configResultSchema }),
  z.object({
    type: z.literal('report'),
    report: z.object({
      ocr: z.object({
        verdict: z.enum(['text_ok', 'ocr_needed']),
        reason: z.string(),
        coverage: z.number(),
      }),
      ranking: z.array(z.number().int()),
      recommendation: z.object({
        configIndex: z.number().int(),
        difySettings: z.string(),
        rationale: z.string(),
      }),
      usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
    }),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
])

export function parseEmbedTestEvent(payload: string): EmbedTestEvent | null {
  let obj: unknown
  try {
    obj = JSON.parse(payload)
  } catch {
    return null
  }
  const parsed = eventSchema.safeParse(obj)
  return parsed.success ? (parsed.data as EmbedTestEvent) : null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/embed-test-parse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/lib/embed-test/parse.ts tests/lib/embed-test-parse.test.ts
git commit -m "feat(embed-test): typed SSE event parsing (client-safe)"
```

---

### Task 6: PDF extraction + page sampling (`extract.ts`)

**Files:**
- Create: `src/server/embed-test/extract.ts`
- Test: `tests/server/embed-test-extract.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/server/embed-test-extract.test.ts
import { describe, expect, test } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'

import {
  buildPdfSample,
  extractPages,
  PdfUnreadableError,
  samplePageIndices,
} from '@/server/embed-test/extract'

describe('samplePageIndices', () => {
  test('small documents return every page', () => {
    expect(samplePageIndices(1)).toEqual([0])
    expect(samplePageIndices(3)).toEqual([0, 1, 2])
    expect(samplePageIndices(5)).toEqual([0, 1, 2, 3, 4])
  })

  test('large documents: first + last + 3 spread, sorted unique', () => {
    const idx = samplePageIndices(20)
    expect(idx).toHaveLength(5)
    expect(idx[0]).toBe(0)
    expect(idx[idx.length - 1]).toBe(19)
    expect([...new Set(idx)]).toEqual(idx)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })
})

async function makePdf(pagesText: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pagesText) {
    const page = doc.addPage()
    page.drawText(text, { x: 50, y: 700, size: 14, font })
  }
  return doc.save()
}

describe('extractPages', () => {
  test('extracts text page by page', async () => {
    const pdf = await makePdf(['Page un contenu', 'Page deux contenu'])
    const { pages, totalPages } = await extractPages(pdf)
    expect(totalPages).toBe(2)
    expect(pages[0]).toContain('Page un')
    expect(pages[1]).toContain('Page deux')
  })

  test('garbage bytes → PdfUnreadableError', async () => {
    await expect(extractPages(new TextEncoder().encode('not a pdf'))).rejects.toThrow(
      PdfUnreadableError,
    )
  })
})

describe('buildPdfSample', () => {
  test('builds a sub-PDF with only the requested pages', async () => {
    const pdf = await makePdf(['A', 'B', 'C', 'D'])
    const sample = await buildPdfSample(pdf, [0, 3])
    const reloaded = await PDFDocument.load(sample)
    expect(reloaded.getPageCount()).toBe(2)
  })
})
```

Note: if `unpdf` fails under the global jsdom environment, add `// @vitest-environment node` as the first line of this test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/embed-test-extract.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/embed-test/extract.ts
/**
 * PDF text extraction (native text layer) + page sampling for the OCR
 * comparison. Server-only.
 */
import { PDFDocument } from 'pdf-lib'
import { extractText, getDocumentProxy } from 'unpdf'

/** Encrypted, corrupted, or not-a-PDF input. */
export class PdfUnreadableError extends Error {
  constructor(cause?: unknown) {
    super('PDF illisible — protégé ou corrompu')
    this.name = 'PdfUnreadableError'
    this.cause = cause
  }
}

export async function extractPages(
  buffer: Uint8Array,
): Promise<{ pages: string[]; totalPages: number }> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { totalPages, text } = await extractText(pdf, { mergePages: false })
    return { pages: text, totalPages }
  } catch (err) {
    throw new PdfUnreadableError(err)
  }
}

/**
 * Picks up to `count` page indices: first, last, and evenly spread interior
 * pages. Deterministic, sorted, unique.
 */
export function samplePageIndices(totalPages: number, count = 5): number[] {
  if (totalPages <= count) {
    return Array.from({ length: totalPages }, (_, i) => i)
  }
  const picked = new Set<number>()
  for (let k = 0; k < count; k++) {
    picked.add(Math.round((k * (totalPages - 1)) / (count - 1)))
  }
  return [...picked].sort((a, b) => a - b)
}

/** Copies the given pages into a fresh PDF (sent to Claude vision). */
export async function buildPdfSample(
  buffer: Uint8Array,
  indices: number[],
): Promise<Uint8Array> {
  try {
    const src = await PDFDocument.load(buffer)
    const out = await PDFDocument.create()
    const copied = await out.copyPages(src, indices)
    for (const page of copied) out.addPage(page)
    return out.save()
  } catch (err) {
    throw new PdfUnreadableError(err)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/embed-test-extract.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/server/embed-test/extract.ts tests/server/embed-test-extract.test.ts
git commit -m "feat(embed-test): pdf text extraction + deterministic page sampling"
```

---

### Task 7: Claude calls (`claude.ts`)

**Files:**
- Create: `src/server/embed-test/claude.ts`
- Test: `tests/server/embed-test-claude.test.ts`

Three typed calls via **forced tool use** (`tool_choice: {type:'tool'}` + `strict: true` input schema) so output is validated JSON, never prose. The Anthropic client is injected as a parameter so tests use a plain fake — no SDK mocking. SDK retries 429/5xx automatically (`maxRetries: 2` default) — that satisfies the spec's "1 retry backoff".

**Models (ids exacts, ne pas suffixer de date):** `claude-sonnet-4-6` (défaut UI) / `claude-opus-4-8`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/server/embed-test-claude.test.ts
import { describe, expect, test, vi } from 'vitest'

import {
  EMBED_TEST_MODELS,
  judgeConfig,
  ocrCompare,
  proposeConfigs,
  type AnthropicLike,
} from '@/server/embed-test/claude'

function fakeClient(toolInput: unknown): AnthropicLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', id: 't1', name: 'output', input: toolInput }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  } as unknown as AnthropicLike
}

const validConfig = {
  label: 'Standard',
  mode: 'general',
  separator: '\\n\\n',
  maxTokens: 1024,
  overlapTokens: 128,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
}

describe('model map', () => {
  test('exact model ids', () => {
    expect(EMBED_TEST_MODELS.sonnet).toBe('claude-sonnet-4-6')
    expect(EMBED_TEST_MODELS.opus).toBe('claude-opus-4-8')
  })
})

describe('ocrCompare', () => {
  test('returns validated verdict + usage', async () => {
    const client = fakeClient({ verdict: 'text_ok', reason: 'couche texte fidèle', coverage: 0.97 })
    const res = await ocrCompare(client, 'claude-sonnet-4-6', 'cGRm', 'texte natif')
    expect(res.data.verdict).toBe('text_ok')
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 50 })
  })

  test('throws on schema mismatch', async () => {
    const client = fakeClient({ verdict: 'maybe' })
    await expect(
      ocrCompare(client, 'claude-sonnet-4-6', 'cGRm', 'texte'),
    ).rejects.toThrow()
  })
})

describe('proposeConfigs', () => {
  test('returns validated configs', async () => {
    const client = fakeClient({ configs: [validConfig, { ...validConfig, maxTokens: 512 }] })
    const res = await proposeConfigs(client, 'claude-sonnet-4-6', 'texte du doc', {
      totalPages: 3,
      totalChars: 5000,
    })
    expect(res.data).toHaveLength(2)
  })

  test('rejects out-of-bounds configs from Claude', async () => {
    const client = fakeClient({ configs: [{ ...validConfig, maxTokens: 99999 }] })
    await expect(
      proposeConfigs(client, 'claude-sonnet-4-6', 'texte', { totalPages: 1, totalChars: 10 }),
    ).rejects.toThrow()
  })
})

describe('judgeConfig', () => {
  test('returns validated judgement', async () => {
    const client = fakeClient({ score: 7.5, issues: ['phrase coupée p.2'], summary: 'correct' })
    const res = await judgeConfig(client, 'claude-sonnet-4-6', 'Standard', [
      { text: 'chunk un' },
      { text: 'chunk deux', parentText: 'parent' },
    ])
    expect(res.data.score).toBe(7.5)
    expect(res.data.issues).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/embed-test-claude.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/embed-test/claude.ts
/**
 * Typed Claude API calls for the embed-test lab. Server-only.
 *
 * Structured outputs via FORCED tool use (tool_choice type:'tool' + strict
 * input schema): the response is always a tool_use block whose input we
 * validate with zod. The client is injected so tests pass a plain fake.
 */
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import {
  chunkConfigSchema,
  type ChunkConfig,
  type EmbedTestModelKey,
  type OcrVerdict,
} from '@/lib/embed-test/types'
import type { Chunk } from '@/lib/embed-test/chunker'

export const EMBED_TEST_MODELS: Record<EmbedTestModelKey, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
}

/** Structural subset of the Anthropic client used here (test seam). */
export type AnthropicLike = {
  messages: { create: (params: Record<string, unknown>) => Promise<unknown> }
}

export function anthropicConfigured(): boolean {
  return typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY !== ''
}

export function createAnthropicClient(): AnthropicLike {
  // SDK auto-retries 429/5xx with backoff (default maxRetries: 2).
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as AnthropicLike
}

export type Usage = { inputTokens: number; outputTokens: number }

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string() }).loose()),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
})

async function forcedToolCall(
  client: AnthropicLike,
  model: string,
  prompt: string | Array<Record<string, unknown>>,
  toolName: string,
  description: string,
  inputSchema: Record<string, unknown>,
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

// ---------------------------------------------------------------- ocrCompare

const ocrVerdictSchema = z.object({
  verdict: z.enum(['text_ok', 'ocr_needed']),
  reason: z.string(),
  coverage: z.number().min(0).max(1),
})

const OCR_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['text_ok', 'ocr_needed'] },
    reason: { type: 'string', description: 'Justification en français, 1-3 phrases' },
    coverage: {
      type: 'number',
      description: 'Part (0..1) du contenu lu visuellement présent dans le texte natif',
    },
  },
  required: ['verdict', 'reason', 'coverage'],
  additionalProperties: false,
} as const

export async function ocrCompare(
  client: AnthropicLike,
  model: string,
  pdfSampleBase64: string,
  nativeText: string,
): Promise<{ data: OcrVerdict; usage: Usage }> {
  const { input, usage } = await forcedToolCall(
    client,
    model,
    [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdfSampleBase64 },
      },
      {
        type: 'text',
        text:
          'Lis visuellement les pages de ce PDF, puis compare avec le texte extrait de la ' +
          'couche texte native des MÊMES pages ci-dessous. Si la couche native est vide, ' +
          'tronquée, désordonnée ou incohérente avec ce que tu lis (document scanné, texte ' +
          'en image), le verdict est ocr_needed. Sinon text_ok.\n\n--- TEXTE NATIF ---\n' +
          nativeText,
      },
    ],
    'output',
    'Rapporte le verdict OCR structuré',
    OCR_TOOL_SCHEMA as unknown as Record<string, unknown>,
  )
  return { data: ocrVerdictSchema.parse(input), usage }
}

// ------------------------------------------------------------ proposeConfigs

const CONFIG_PROPERTIES = {
  label: { type: 'string' },
  mode: { type: 'string', enum: ['general', 'parent-child'] },
  separator: { type: 'string', description: 'Délimiteur, ex "\\n\\n" ou "\\n" ou "###"' },
  maxTokens: { type: 'integer', description: 'Longueur max de chunk en tokens (100-4000)' },
  overlapTokens: { type: 'integer', description: 'Chevauchement en tokens, < maxTokens' },
  parentMaxTokens: { type: 'integer' },
  childMaxTokens: { type: 'integer' },
  preprocessing: {
    type: 'object',
    properties: {
      removeExtraSpaces: { type: 'boolean' },
      removeUrlsEmails: { type: 'boolean' },
    },
    required: ['removeExtraSpaces', 'removeUrlsEmails'],
    additionalProperties: false,
  },
  rationale: { type: 'string' },
} as const

const PROPOSE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    configs: {
      type: 'array',
      items: {
        type: 'object',
        properties: CONFIG_PROPERTIES,
        required: ['label', 'mode', 'separator', 'maxTokens', 'overlapTokens', 'preprocessing'],
        additionalProperties: false,
      },
    },
  },
  required: ['configs'],
  additionalProperties: false,
} as const

const proposeOutputSchema = z.object({
  configs: z.array(chunkConfigSchema).min(2).max(6),
})

export async function proposeConfigs(
  client: AnthropicLike,
  model: string,
  textSample: string,
  stats: { totalPages: number; totalChars: number },
): Promise<{ data: ChunkConfig[]; usage: Usage }> {
  const { input, usage } = await forcedToolCall(
    client,
    model,
    'Tu prépares l\'ingestion d\'un document dans une base de connaissance Dify (RAG). ' +
      'Analyse la structure du texte ci-dessous (titres, paragraphes, listes, tableaux, ' +
      `densité). Document : ${stats.totalPages} pages, ${stats.totalChars} caractères. ` +
      'Propose 4 à 6 configurations de chunking PERTINENTES et CONTRASTÉES à tester, ' +
      'alignées sur les options de l\'UI Dify (mode Général ou Parent-enfant, délimiteur, ' +
      'longueur max en tokens 100-4000, chevauchement < longueur max, prétraitement). ' +
      'En mode parent-child, fournis parentMaxTokens et childMaxTokens.\n\n--- DOCUMENT ---\n' +
      textSample,
    'output',
    'Rapporte les configurations de chunking à tester',
    PROPOSE_TOOL_SCHEMA as unknown as Record<string, unknown>,
  )
  return { data: proposeOutputSchema.parse(input).configs, usage }
}

// --------------------------------------------------------------- judgeConfig

const judgementSchema = z.object({
  score: z.number().min(0).max(10),
  issues: z.array(z.string()),
  summary: z.string(),
})

const JUDGE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number', description: 'Note 0-10 de qualité structurelle des chunks' },
    issues: { type: 'array', items: { type: 'string' }, description: 'Problèmes relevés, en français' },
    summary: { type: 'string', description: 'Synthèse 1-2 phrases en français' },
  },
  required: ['score', 'issues', 'summary'],
  additionalProperties: false,
} as const

export async function judgeConfig(
  client: AnthropicLike,
  model: string,
  configLabel: string,
  chunks: Chunk[],
): Promise<{ data: { score: number; issues: string[]; summary: string }; usage: Usage }> {
  const rendered = chunks
    .map((c, i) => {
      const parent = c.parentText ? `\n[CONTEXTE PARENT]\n${c.parentText}` : ''
      return `=== CHUNK ${i + 1} ===\n${c.text}${parent}`
    })
    .join('\n\n')
  const { input, usage } = await forcedToolCall(
    client,
    model,
    `Évalue la qualité STRUCTURELLE de ce découpage en chunks (config "${configLabel}") ` +
      'pour du retrieval RAG : phrases coupées en plein milieu, idées fragmentées entre ' +
      'chunks, tableaux ou listes cassés, chunks orphelins sans contexte, chunks trop ' +
      'hétérogènes. Note de 0 (inutilisable) à 10 (parfait). Liste les problèmes concrets.\n\n' +
      rendered,
    'output',
    'Rapporte le jugement structuré de la config',
    JUDGE_TOOL_SCHEMA as unknown as Record<string, unknown>,
  )
  return { data: judgementSchema.parse(input), usage }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/embed-test-claude.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/server/embed-test/claude.ts tests/server/embed-test-claude.test.ts
git commit -m "feat(embed-test): typed Claude calls via forced tool use (ocr/propose/judge)"
```

---

### Task 8: Dify settings formatter (`dify-settings.ts`)

**Files:**
- Create: `src/lib/embed-test/dify-settings.ts`
- Test: `tests/lib/embed-test-dify-settings.test.ts`

The copy-paste recommendation text is built **deterministically in code** (not by Claude) from the winning config + OCR verdict, in Dify UI vocabulary.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/embed-test-dify-settings.test.ts
import { describe, expect, test } from 'vitest'

import { formatDifySettings } from '@/lib/embed-test/dify-settings'
import type { ChunkConfig, OcrVerdict } from '@/lib/embed-test/types'

const config: ChunkConfig = {
  label: 'Standard',
  mode: 'general',
  separator: '\\n\\n',
  maxTokens: 1024,
  overlapTokens: 128,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
}
const ocrOk: OcrVerdict = { verdict: 'text_ok', reason: 'fidèle', coverage: 0.98 }

describe('formatDifySettings', () => {
  test('general mode in Dify UI vocabulary', () => {
    const out = formatDifySettings(config, ocrOk)
    expect(out).toContain('Mode : Général')
    expect(out).toContain('Délimiteur : \\n\\n')
    expect(out).toContain('Longueur max : 1024 tokens')
    expect(out).toContain('Chevauchement : 128 tokens')
    expect(out).toContain('Remplacer les espaces consécutifs : oui')
    expect(out).toContain('Supprimer URLs et e-mails : non')
    expect(out).toContain('Pipeline : extraction texte (OCR inutile)')
  })

  test('parent-child mode + OCR needed', () => {
    const out = formatDifySettings(
      { ...config, mode: 'parent-child', parentMaxTokens: 2000, childMaxTokens: 400 },
      { verdict: 'ocr_needed', reason: 'scanné', coverage: 0.1 },
    )
    expect(out).toContain('Mode : Parent-enfant')
    expect(out).toContain('Parent : 2000 tokens')
    expect(out).toContain('Enfant : 400 tokens')
    expect(out).toContain('Pipeline : ACTIVEZ le pipeline OCR')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/embed-test-dify-settings.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/embed-test/dify-settings.ts
/**
 * Renders the winning config as copy-paste text in Dify UI vocabulary.
 * Deterministic (built in code, not by Claude) so the recommendation always
 * maps 1:1 to the knobs the admin sets manually in Dify.
 */
import type { ChunkConfig, OcrVerdict } from '@/lib/embed-test/types'

function ouiNon(v: boolean): string {
  return v ? 'oui' : 'non'
}

export function formatDifySettings(config: ChunkConfig, ocr: OcrVerdict): string {
  const lines: string[] = []
  if (config.mode === 'general') {
    lines.push('Mode : Général')
    lines.push(`Délimiteur : ${config.separator}`)
    lines.push(`Longueur max : ${config.maxTokens} tokens`)
    lines.push(`Chevauchement : ${config.overlapTokens} tokens`)
  } else {
    lines.push('Mode : Parent-enfant')
    lines.push(`Délimiteur : ${config.separator}`)
    lines.push(`Parent : ${config.parentMaxTokens} tokens`)
    lines.push(`Enfant : ${config.childMaxTokens} tokens`)
  }
  lines.push(
    `Prétraitement — Remplacer les espaces consécutifs : ${ouiNon(config.preprocessing.removeExtraSpaces)}`,
  )
  lines.push(
    `Prétraitement — Supprimer URLs et e-mails : ${ouiNon(config.preprocessing.removeUrlsEmails)}`,
  )
  lines.push(
    ocr.verdict === 'ocr_needed'
      ? 'Pipeline : ACTIVEZ le pipeline OCR (couche texte non fiable)'
      : 'Pipeline : extraction texte (OCR inutile)',
  )
  return lines.join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/embed-test-dify-settings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/lib/embed-test/dify-settings.ts tests/lib/embed-test-dify-settings.test.ts
git commit -m "feat(embed-test): deterministic Dify-UI recommendation formatter"
```

---

### Task 9: Pipeline orchestration (`pipeline.ts`)

**Files:**
- Create: `src/server/embed-test/pipeline.ts`
- Test: `tests/server/embed-test-pipeline.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/server/embed-test-pipeline.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest'

const extractPages = vi.fn()
const buildPdfSample = vi.fn()
vi.mock('@/server/embed-test/extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/embed-test/extract')>()
  return {
    ...actual,
    extractPages: (...a: unknown[]) => extractPages(...a),
    buildPdfSample: (...a: unknown[]) => buildPdfSample(...a),
  }
})

const ocrCompare = vi.fn()
const proposeConfigs = vi.fn()
const judgeConfig = vi.fn()
vi.mock('@/server/embed-test/claude', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/embed-test/claude')>()
  return {
    ...actual,
    createAnthropicClient: () => ({}),
    ocrCompare: (...a: unknown[]) => ocrCompare(...a),
    proposeConfigs: (...a: unknown[]) => proposeConfigs(...a),
    judgeConfig: (...a: unknown[]) => judgeConfig(...a),
  }
})

import { runEmbedTest } from '@/server/embed-test/pipeline'
import { PdfUnreadableError } from '@/server/embed-test/extract'
import type { ChunkConfig, EmbedTestEvent } from '@/lib/embed-test/types'

const config = (label: string): ChunkConfig => ({
  label,
  mode: 'general',
  separator: '\\n\\n',
  maxTokens: 200,
  overlapTokens: 0,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
})

const usage = { inputTokens: 10, outputTokens: 5 }

beforeEach(() => {
  vi.clearAllMocks()
  extractPages.mockResolvedValue({
    pages: ['Texte page un.\n\nDeuxième paragraphe.', 'Texte page deux.'],
    totalPages: 2,
  })
  buildPdfSample.mockResolvedValue(new Uint8Array([1, 2, 3]))
  ocrCompare.mockResolvedValue({
    data: { verdict: 'text_ok', reason: 'ok', coverage: 0.95 },
    usage,
  })
  proposeConfigs.mockResolvedValue({ data: [config('A'), config('B')], usage })
  judgeConfig.mockResolvedValue({
    data: { score: 8, issues: [], summary: 'bien' },
    usage,
  })
})

async function collect(): Promise<EmbedTestEvent[]> {
  const events: EmbedTestEvent[] = []
  await runEmbedTest(new Uint8Array([0]), 'sonnet', (e) => events.push(e))
  return events
}

describe('runEmbedTest — nominal', () => {
  test('emits steps, configs, results, and a final report with usage totals', async () => {
    const events = await collect()
    const types = events.map((e) => e.type)
    expect(types).toContain('step')
    expect(types).toContain('configs')
    expect(types.filter((t) => t === 'config-result')).toHaveLength(2)
    const report = events.find((e) => e.type === 'report')
    expect(report).toBeDefined()
    if (report?.type === 'report') {
      expect(report.report.ocr.verdict).toBe('text_ok')
      expect(report.report.ranking).toHaveLength(2)
      expect(report.report.recommendation.difySettings).toContain('Mode : Général')
      // 1 ocr + 1 propose + 2 judges = 4 calls x usage
      expect(report.report.usage).toEqual({ inputTokens: 40, outputTokens: 20 })
    }
  })

  test('ranking sorts by score descending', async () => {
    judgeConfig
      .mockResolvedValueOnce({ data: { score: 3, issues: ['x'], summary: 's' }, usage })
      .mockResolvedValueOnce({ data: { score: 9, issues: [], summary: 's' }, usage })
    const events = await collect()
    const report = events.find((e) => e.type === 'report')
    if (report?.type === 'report') {
      expect(report.report.ranking[0]).toBe(1)
      expect(report.report.recommendation.configIndex).toBe(1)
    }
  })
})

describe('runEmbedTest — failures', () => {
  test('one judge failure → config marked failed, run continues', async () => {
    judgeConfig
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: { score: 6, issues: [], summary: 's' }, usage })
    const events = await collect()
    const results = events.filter((e) => e.type === 'config-result')
    expect(results).toHaveLength(2)
    expect(results.some((r) => r.type === 'config-result' && r.result.failed)).toBe(true)
    expect(events.some((e) => e.type === 'report')).toBe(true)
  })

  test('unreadable pdf → dedicated error event, no report', async () => {
    extractPages.mockRejectedValueOnce(new PdfUnreadableError())
    const events = await collect()
    const error = events.find((e) => e.type === 'error')
    expect(error?.type === 'error' && error.code).toBe('pdf_unreadable')
    expect(events.some((e) => e.type === 'report')).toBe(false)
  })

  test('proposeConfigs failure → fatal error event', async () => {
    proposeConfigs.mockRejectedValueOnce(new Error('api down'))
    const events = await collect()
    expect(events.some((e) => e.type === 'error')).toBe(true)
    expect(events.some((e) => e.type === 'report')).toBe(false)
  })

  test('ocr_needed verdict propagates to recommendation', async () => {
    ocrCompare.mockResolvedValueOnce({
      data: { verdict: 'ocr_needed', reason: 'scanné', coverage: 0.05 },
      usage,
    })
    const events = await collect()
    const report = events.find((e) => e.type === 'report')
    if (report?.type === 'report') {
      expect(report.report.ocr.verdict).toBe('ocr_needed')
      expect(report.report.recommendation.difySettings).toContain('ACTIVEZ le pipeline OCR')
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/embed-test-pipeline.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/embed-test/pipeline.ts
/**
 * Orchestrates one embed-test run. Emits typed SSE events via the `emit`
 * callback; never throws for per-config failures (config marked failed, run
 * continues). Extraction/analysis failures are fatal (error event, stop).
 */
import { chunkDocument, type Chunk } from '@/lib/embed-test/chunker'
import { formatDifySettings } from '@/lib/embed-test/dify-settings'
import type {
  ConfigResult,
  EmbedTestEvent,
  EmbedTestModelKey,
} from '@/lib/embed-test/types'
import {
  createAnthropicClient,
  EMBED_TEST_MODELS,
  judgeConfig,
  ocrCompare,
  proposeConfigs,
  type Usage,
} from '@/server/embed-test/claude'
import {
  buildPdfSample,
  extractPages,
  PdfUnreadableError,
  samplePageIndices,
} from '@/server/embed-test/extract'

// Cost guardrails (spec §3)
const MAX_VISION_PAGES = 5
const MAX_ANALYSIS_CHARS = 80_000
const MAX_JUDGED_CHUNKS = 15

/** First/middle/last sampling so the judge sees the whole document's shape. */
export function sampleChunks(chunks: Chunk[], max = MAX_JUDGED_CHUNKS): Chunk[] {
  if (chunks.length <= max) return chunks
  const third = Math.floor(max / 3)
  const head = chunks.slice(0, third)
  const midStart = Math.floor(chunks.length / 2 - third / 2)
  const middle = chunks.slice(midStart, midStart + third)
  const tail = chunks.slice(chunks.length - (max - 2 * third))
  return [...head, ...middle, ...tail]
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

export async function runEmbedTest(
  buffer: Uint8Array,
  modelKey: EmbedTestModelKey,
  emit: (event: EmbedTestEvent) => void,
): Promise<void> {
  const model = EMBED_TEST_MODELS[modelKey]
  const client = createAnthropicClient()
  const total: Usage = { inputTokens: 0, outputTokens: 0 }
  const add = (u: Usage) => {
    total.inputTokens += u.inputTokens
    total.outputTokens += u.outputTokens
  }

  // 1. Native text extraction
  emit({ type: 'step', id: 'extract', label: 'Extraction du texte du PDF…' })
  let pages: string[]
  let totalPages: number
  try {
    const extracted = await extractPages(buffer)
    pages = extracted.pages
    totalPages = extracted.totalPages
  } catch (err) {
    emit({
      type: 'error',
      code: err instanceof PdfUnreadableError ? 'pdf_unreadable' : 'extract_failed',
      message: 'PDF illisible — protégé, corrompu ou non valide.',
    })
    return
  }
  const fullText = pages.join('\n\n')

  // 2. OCR verdict on sampled pages (vision vs native text layer)
  emit({ type: 'step', id: 'ocr', label: 'Comparaison OCR vs extraction texte…' })
  const indices = samplePageIndices(totalPages, MAX_VISION_PAGES)
  let ocr
  try {
    const samplePdf = await buildPdfSample(buffer, indices)
    const nativeSample = indices.map((i) => pages[i] ?? '').join('\n\n--- PAGE ---\n\n')
    const res = await ocrCompare(client, model, toBase64(samplePdf), nativeSample)
    add(res.usage)
    ocr = res.data
  } catch {
    emit({
      type: 'error',
      code: 'ocr_compare_failed',
      message: "L'analyse OCR via l'API Claude a échoué. Réessayez.",
    })
    return
  }

  // 3. Claude proposes configs from document structure
  emit({ type: 'step', id: 'propose', label: 'Claude analyse la structure et propose des configurations…' })
  let configs
  try {
    const res = await proposeConfigs(client, model, fullText.slice(0, MAX_ANALYSIS_CHARS), {
      totalPages,
      totalChars: fullText.length,
    })
    add(res.usage)
    configs = res.data
  } catch {
    emit({
      type: 'error',
      code: 'propose_failed',
      message: "La proposition de configurations via l'API Claude a échoué. Réessayez.",
    })
    return
  }
  emit({ type: 'configs', items: configs })

  // 4. Local chunking + judge, sequential, failures non-fatal
  const results: ConfigResult[] = []
  for (let i = 0; i < configs.length; i++) {
    emit({ type: 'step', id: `judge:${i}`, label: `Jugement de la config ${i + 1}/${configs.length}…` })
    const chunks = chunkDocument(fullText, configs[i])
    let result: ConfigResult
    try {
      const res = await judgeConfig(client, model, configs[i].label, sampleChunks(chunks))
      add(res.usage)
      result = { index: i, ...res.data, chunkCount: chunks.length }
    } catch {
      result = {
        index: i,
        score: 0,
        issues: [],
        summary: 'Échec du jugement (API)',
        chunkCount: chunks.length,
        failed: true,
      }
    }
    results.push(result)
    emit({ type: 'config-result', result })
  }

  // 5. Report
  emit({ type: 'step', id: 'report', label: 'Construction du rapport…' })
  const ranked = results
    .filter((r) => !r.failed)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.index)
  if (ranked.length === 0) {
    emit({
      type: 'error',
      code: 'all_judges_failed',
      message: 'Aucune configuration n\'a pu être jugée. Réessayez.',
    })
    return
  }
  const bestIndex = ranked[0]
  emit({
    type: 'report',
    report: {
      ocr,
      ranking: ranked,
      recommendation: {
        configIndex: bestIndex,
        difySettings: formatDifySettings(configs[bestIndex], ocr),
        rationale: results.find((r) => r.index === bestIndex)?.summary ?? '',
      },
      usage: total,
    },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/embed-test-pipeline.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/server/embed-test/pipeline.ts tests/server/embed-test-pipeline.test.ts
git commit -m "feat(embed-test): pipeline orchestration with partial-failure tolerance"
```

---

### Task 10: Route handler (`/api/admin/embed-test`)

**Files:**
- Create: `src/app/api/admin/embed-test/route.ts`
- Test: `tests/server/embed-test-route.test.ts`

Guard/validation conventions copied from `src/app/api/admin/formations/[id]/documents/route.ts`; SSE response convention from `src/app/api/brain/route.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/server/embed-test-route.test.ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const auth = vi.fn()
vi.mock('@/server/auth', () => ({ auth: () => auth() }))

const runEmbedTest = vi.fn()
vi.mock('@/server/embed-test/pipeline', () => ({
  runEmbedTest: (...a: unknown[]) => runEmbedTest(...a),
}))

import { POST } from '@/app/api/admin/embed-test/route'

function makeRequest(opts?: { file?: File | null; model?: string }): Request {
  const form = new FormData()
  const file =
    opts?.file === null
      ? undefined
      : (opts?.file ?? new File(['%PDF-1.4 fake'], 'doc.pdf', { type: 'application/pdf' }))
  if (file) form.set('file', file)
  if (opts?.model) form.set('model', opts.model)
  return new Request('http://localhost/api/admin/embed-test', { method: 'POST', body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'sk-test'
  auth.mockResolvedValue({ user: { id: 'a1', role: 'admin' } })
  runEmbedTest.mockImplementation(
    async (_buf: unknown, _model: unknown, emit: (e: unknown) => void) => {
      emit({ type: 'step', id: 'extract', label: 'x' })
    },
  )
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
})

describe('POST /api/admin/embed-test — guards', () => {
  test('not authenticated → 401', async () => {
    auth.mockResolvedValue(null)
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  test('employee → 403', async () => {
    auth.mockResolvedValue({ user: { id: 'u1', role: 'employee' } })
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
  })

  test('missing ANTHROPIC_API_KEY → 503 before any work', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const res = await POST(makeRequest())
    expect(res.status).toBe(503)
    expect(runEmbedTest).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/embed-test — validation', () => {
  test('missing file → 400', async () => {
    const res = await POST(makeRequest({ file: null }))
    expect(res.status).toBe(400)
  })

  test('non-pdf → 415', async () => {
    const res = await POST(
      makeRequest({ file: new File(['x'], 'a.txt', { type: 'text/plain' }) }),
    )
    expect(res.status).toBe(415)
  })

  test('unknown model → 400', async () => {
    const res = await POST(makeRequest({ model: 'gpt' }))
    expect(res.status).toBe(400)
  })

  test('oversize file → 413', async () => {
    const big = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'big.pdf', {
      type: 'application/pdf',
    })
    const res = await POST(makeRequest({ file: big }))
    expect(res.status).toBe(413)
  })
})

describe('POST /api/admin/embed-test — SSE', () => {
  test('valid request streams events and defaults to sonnet', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    const body = await res.text()
    expect(body).toContain('data: ')
    expect(body).toContain('"type":"step"')
    expect(runEmbedTest).toHaveBeenCalledWith(expect.anything(), 'sonnet', expect.any(Function))
  })

  test('model=opus is forwarded', async () => {
    await (await POST(makeRequest({ model: 'opus' }))).text()
    expect(runEmbedTest).toHaveBeenCalledWith(expect.anything(), 'opus', expect.any(Function))
  })

  test('pipeline throw → error event in stream, not a crash', async () => {
    runEmbedTest.mockRejectedValueOnce(new Error('boom'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('"type":"error"')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/embed-test-route.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/admin/embed-test/route.ts
import { auth } from '@/server/auth'
import { runEmbedTest } from '@/server/embed-test/pipeline'
import { EMBED_TEST_MODEL_KEYS, type EmbedTestModelKey } from '@/lib/embed-test/types'

export const runtime = 'nodejs'

const MAX_SIZE = 25 * 1024 * 1024 // 25 Mo — same ceiling as the documents upload

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Banc d'essai des paramètres d'ingestion Dify. Admin uniquement.
 * Reçoit un PDF en multipart, streame la progression et le rapport en SSE.
 * AUCUN appel à Dify — l'outil est autonome (voir la spec).
 */
export async function POST(req: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user) return json({ error: 'unauthorized' }, 401)
  if (session.user.role !== 'admin') return json({ error: 'forbidden' }, 403)

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'anthropic_not_configured' }, 503)
  }

  let file: File
  let model: EmbedTestModelKey
  try {
    const form = await req.formData()
    const rawFile = form.get('file')
    if (!(rawFile instanceof File)) return json({ error: 'file_required' }, 400)
    file = rawFile
    if (file.type !== 'application/pdf') return json({ error: 'invalid_type' }, 415)
    if (file.size > MAX_SIZE) return json({ error: 'file_too_large' }, 413)

    const rawModel = form.get('model')
    if (rawModel == null || rawModel === '') {
      model = 'sonnet'
    } else if (
      typeof rawModel === 'string' &&
      (EMBED_TEST_MODEL_KEYS as readonly string[]).includes(rawModel)
    ) {
      model = rawModel as EmbedTestModelKey
    } else {
      return json({ error: 'invalid_model' }, 400)
    }
  } catch {
    return json({ error: 'invalid_form' }, 400)
  }

  const buffer = new Uint8Array(await file.arrayBuffer())
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      try {
        await runEmbedTest(buffer, model, emit)
      } catch (err) {
        console.error('[embed-test] run a échoué:', err)
        emit({
          type: 'error',
          code: 'internal',
          message: 'Le test a échoué de façon inattendue. Réessayez.',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/embed-test-route.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/app/api/admin/embed-test/route.ts tests/server/embed-test-route.test.ts
git commit -m "feat(embed-test): admin SSE route with guards and validations"
```

---

### Task 11: Client hook (`useEmbedTest`)

**Files:**
- Create: `src/lib/embed-test/useEmbedTest.ts`
- Test: `tests/lib/embed-test-reduce.test.ts`

Same architecture as `useBrainChat`: a PURE exported reducer (`applyEvent`) tested directly, plus the hook that runs the fetch + stream loop reusing `splitSSEFrames` (from `@/lib/brain/useBrainChat`) and `parseSSELines` (from `@/lib/dify/parse`).

- [ ] **Step 1: Write the failing tests (pure reducer + error mapping)**

```typescript
// tests/lib/embed-test-reduce.test.ts
import { describe, expect, test } from 'vitest'

import {
  applyEvent,
  httpErrorText,
  initialState,
  type EmbedTestState,
} from '@/lib/embed-test/useEmbedTest'
import type { EmbedTestEvent } from '@/lib/embed-test/types'

const config = {
  label: 'A',
  mode: 'general' as const,
  separator: '\\n\\n',
  maxTokens: 1024,
  overlapTokens: 0,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
}

function run(events: EmbedTestEvent[]): EmbedTestState {
  return events.reduce(applyEvent, { ...initialState, status: 'running' })
}

describe('applyEvent', () => {
  test('accumulates steps, configs, results, report', () => {
    const report = {
      ocr: { verdict: 'text_ok' as const, reason: 'r', coverage: 0.9 },
      ranking: [0],
      recommendation: { configIndex: 0, difySettings: 's', rationale: 'r' },
      usage: { inputTokens: 1, outputTokens: 2 },
    }
    const state = run([
      { type: 'step', id: 'extract', label: 'Extraction…' },
      { type: 'configs', items: [config] },
      {
        type: 'config-result',
        result: { index: 0, score: 8, issues: [], summary: 's', chunkCount: 3 },
      },
      { type: 'report', report },
    ])
    expect(state.steps).toHaveLength(1)
    expect(state.configs).toHaveLength(1)
    expect(state.results).toHaveLength(1)
    expect(state.report).toEqual(report)
    expect(state.status).toBe('done')
  })

  test('error event → status error with message', () => {
    const state = run([{ type: 'error', code: 'pdf_unreadable', message: 'PDF illisible' }])
    expect(state.status).toBe('error')
    expect(state.error).toBe('PDF illisible')
  })
})

describe('httpErrorText', () => {
  test('maps known statuses to French messages', () => {
    expect(httpErrorText(413)).toContain('25 Mo')
    expect(httpErrorText(415)).toContain('PDF')
    expect(httpErrorText(503)).toContain('Anthropic')
    expect(httpErrorText(403)).toContain('admin')
    expect(httpErrorText(500)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/embed-test-reduce.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/embed-test/useEmbedTest.ts
'use client'

import { useCallback, useRef, useState } from 'react'

import { splitSSEFrames } from '@/lib/brain/useBrainChat'
import { parseSSELines } from '@/lib/dify/parse'
import { parseEmbedTestEvent } from '@/lib/embed-test/parse'
import type {
  ChunkConfig,
  ConfigResult,
  EmbedTestEvent,
  EmbedTestModelKey,
  EmbedTestReport,
} from '@/lib/embed-test/types'

export type EmbedTestStatus = 'idle' | 'running' | 'done' | 'error'

export type EmbedTestState = {
  status: EmbedTestStatus
  steps: Array<{ id: string; label: string }>
  configs: ChunkConfig[]
  results: ConfigResult[]
  report: EmbedTestReport | null
  error: string | null
}

export const initialState: EmbedTestState = {
  status: 'idle',
  steps: [],
  configs: [],
  results: [],
  report: null,
  error: null,
}

/** Pure reducer — the streaming loop is built on it (same pattern as reduceFrame). */
export function applyEvent(state: EmbedTestState, event: EmbedTestEvent): EmbedTestState {
  switch (event.type) {
    case 'step':
      return { ...state, steps: [...state.steps, { id: event.id, label: event.label }] }
    case 'configs':
      return { ...state, configs: event.items }
    case 'config-result':
      return { ...state, results: [...state.results, event.result] }
    case 'report':
      return { ...state, report: event.report, status: 'done' }
    case 'error':
      return { ...state, status: 'error', error: event.message }
  }
}

/** French messages for HTTP-level failures (before the SSE stream starts). */
export function httpErrorText(status: number): string {
  switch (status) {
    case 400:
      return 'Requête invalide — vérifiez le fichier et le modèle.'
    case 401:
    case 403:
      return 'Accès refusé — réservé aux admin.'
    case 413:
      return 'Fichier trop volumineux (25 Mo max).'
    case 415:
      return 'Seuls les PDF sont acceptés.'
    case 503:
      return "Clé API Anthropic non configurée sur le serveur."
    default:
      return 'Le test a échoué. Réessayez.'
  }
}

export type UseEmbedTest = {
  state: EmbedTestState
  run: (file: File, model: EmbedTestModelKey) => Promise<void>
  reset: () => void
}

export function useEmbedTest(): UseEmbedTest {
  const [state, setState] = useState<EmbedTestState>(initialState)
  const runningRef = useRef(false)

  const reset = useCallback(() => setState(initialState), [])

  const run = useCallback(async (file: File, model: EmbedTestModelKey) => {
    if (runningRef.current) return
    runningRef.current = true
    setState({ ...initialState, status: 'running' })

    const fail = (message: string) =>
      setState((prev) => ({ ...prev, status: 'error', error: message }))

    try {
      const form = new FormData()
      form.set('file', file)
      form.set('model', model)
      const res = await fetch('/api/admin/embed-test', { method: 'POST', body: form })
      if (!res.ok || !res.body) {
        fail(httpErrorText(res.status))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const handleFrame = (frame: string) => {
        for (const payload of parseSSELines(frame)) {
          const event = parseEmbedTestEvent(payload)
          if (event) setState((prev) => applyEvent(prev, event))
        }
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = splitSSEFrames(buffer)
        buffer = rest
        frames.forEach(handleFrame)
      }
      buffer += decoder.decode()
      if (buffer.trim().length > 0) handleFrame(buffer)

      // Stream ended without report nor error event → treat as failure.
      setState((prev) =>
        prev.status === 'running'
          ? { ...prev, status: 'error', error: 'Flux interrompu. Réessayez.' }
          : prev,
      )
    } catch {
      fail('Connexion interrompue. Réessayez.')
    } finally {
      runningRef.current = false
    }
  }, [])

  return { state, run, reset }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/embed-test-reduce.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```powershell
git add src/lib/embed-test/useEmbedTest.ts tests/lib/embed-test-reduce.test.ts
git commit -m "feat(embed-test): client stream hook with pure reducer + FR error mapping"
```

---

### Task 12: UI — `EmbedTestAdmin` + page + nav

**Files:**
- Create: `src/components/admin/EmbedTestAdmin.tsx`
- Create: `src/app/admin/embed-test/page.tsx`
- Modify: `src/components/admin/AdminNav.tsx:8-15` (NAV_ITEMS)
- Test: `tests/components/EmbedTestAdmin.test.tsx`

UI conventions: server shell mince + composant client (pattern de toutes les pages admin), classes Tailwind du repo (`bg-white` explicite — JAMAIS `bg-card`, cf. mémoire projet), libellés français.

- [ ] **Step 1: Write the failing component test**

```tsx
// tests/components/EmbedTestAdmin.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/embed-test/useEmbedTest', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/embed-test/useEmbedTest')>()
  return {
    ...actual,
    useEmbedTest: () => ({ state: actual.initialState, run: vi.fn(), reset: vi.fn() }),
  }
})

import { EmbedTestAdmin } from '@/components/admin/EmbedTestAdmin'

describe('EmbedTestAdmin', () => {
  test('renders upload form with sonnet default and disabled launch button', () => {
    render(<EmbedTestAdmin />)
    expect(screen.getByText(/Labo d'embed/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Fichier PDF/i)).toBeInTheDocument()
    const select = screen.getByLabelText(/Modèle/i) as HTMLSelectElement
    expect(select.value).toBe('sonnet')
    expect(screen.getByRole('button', { name: /Lancer le test/i })).toBeDisabled()
    expect(screen.getByText(/API Claude d'Anthropic/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/EmbedTestAdmin.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Write the component**

```tsx
// src/components/admin/EmbedTestAdmin.tsx
'use client'

import { useState } from 'react'

import { useEmbedTest } from '@/lib/embed-test/useEmbedTest'
import type { EmbedTestModelKey } from '@/lib/embed-test/types'

const MAX_SIZE = 25 * 1024 * 1024

export function EmbedTestAdmin() {
  const { state, run, reset } = useEmbedTest()
  const [file, setFile] = useState<File | null>(null)
  const [model, setModel] = useState<EmbedTestModelKey>('sonnet')
  const [copied, setCopied] = useState(false)

  const running = state.status === 'running'
  const canLaunch = file != null && !running

  const onLaunch = () => {
    if (!file) return
    if (file.size > MAX_SIZE) return
    setCopied(false)
    void run(file, model)
  }

  const onCopy = async () => {
    if (!state.report) return
    await navigator.clipboard.writeText(state.report.recommendation.difySettings)
    setCopied(true)
  }

  const best = state.report?.recommendation.configIndex

  return (
    <div className="mx-auto max-w-[860px] px-6 py-8">
      <h1 className="font-serif text-[26px] font-semibold">Labo d&apos;embed</h1>
      <p className="mt-1 text-[14px] text-sub">
        Testez les paramètres d&apos;ingestion d&apos;un document avant de les reporter
        manuellement dans Dify. Aucun envoi vers Dify.
      </p>

      {/* Formulaire */}
      <section className="mt-6 rounded-xl border border-line bg-white p-5">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            Fichier PDF (25 Mo max)
            <input
              type="file"
              accept="application/pdf"
              disabled={running}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-[13.5px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            Modèle
            <select
              value={model}
              disabled={running}
              onChange={(e) => setModel(e.target.value as EmbedTestModelKey)}
              className="w-fit rounded-lg border border-line px-3 py-2 text-[13.5px]"
            >
              <option value="sonnet">Sonnet 4.6 — recommandé (~0,10-0,50 $ / test)</option>
              <option value="opus">Opus 4.8 — qualité max (~0,50-2,50 $ / test)</option>
            </select>
          </label>
          <p className="text-[12.5px] text-sub">
            Le document est analysé par l&apos;API Claude d&apos;Anthropic (service externe).
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onLaunch}
              disabled={!canLaunch}
              className="rounded-lg bg-red px-4 py-2 text-[14px] font-bold text-white disabled:opacity-40"
            >
              {running ? 'Test en cours…' : 'Lancer le test'}
            </button>
            {(state.status === 'done' || state.status === 'error') && (
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-line px-4 py-2 text-[14px] font-medium"
              >
                Relancer
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Timeline */}
      {state.steps.length > 0 && (
        <section className="mt-6 rounded-xl border border-line bg-white p-5" role="status">
          <h2 className="text-[15px] font-bold">Progression</h2>
          <ul className="mt-2 flex flex-col gap-1 text-[13.5px]">
            {state.steps.map((s, i) => (
              <li key={`${s.id}-${i}`} className="flex items-center gap-2">
                <span aria-hidden>{i < state.steps.length - 1 || !running ? '✓' : '…'}</span>
                {s.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Erreur */}
      {state.status === 'error' && state.error && (
        <section className="mt-6 rounded-xl border border-red/40 bg-white p-5 text-[14px]" role="alert">
          {state.error}
        </section>
      )}

      {/* Rapport */}
      {state.report && (
        <>
          <section className="mt-6 rounded-xl border border-line bg-white p-5">
            <h2 className="text-[15px] font-bold">Verdict extraction</h2>
            <p className="mt-1 text-[14px]">
              {state.report.ocr.verdict === 'text_ok'
                ? '✅ L\'extraction texte basique suffit.'
                : '⚠️ Passez par le pipeline OCR — couche texte non fiable.'}
            </p>
            <p className="mt-1 text-[13px] text-sub">{state.report.ocr.reason}</p>
          </section>

          <section className="mt-6 rounded-xl border border-line bg-white p-5">
            <h2 className="text-[15px] font-bold">Configurations testées</h2>
            <table className="mt-3 w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-sub">
                  <th className="py-2 pr-3">Config</th>
                  <th className="py-2 pr-3">Mode</th>
                  <th className="py-2 pr-3">Taille</th>
                  <th className="py-2 pr-3">Overlap</th>
                  <th className="py-2 pr-3">Chunks</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2">Problèmes</th>
                </tr>
              </thead>
              <tbody>
                {state.report.ranking
                  .map((idx) => ({
                    config: state.configs[idx],
                    result: state.results.find((r) => r.index === idx),
                  }))
                  .concat(
                    state.results
                      .filter((r) => r.failed)
                      .map((r) => ({ config: state.configs[r.index], result: r })),
                  )
                  .map(({ config, result }) =>
                    config && result ? (
                      <tr
                        key={result.index}
                        className={`border-b border-line/60 ${result.failed ? 'opacity-40' : ''} ${
                          result.index === best ? 'font-bold' : ''
                        }`}
                      >
                        <td className="py-2 pr-3">{config.label}</td>
                        <td className="py-2 pr-3">
                          {config.mode === 'general' ? 'Général' : 'Parent-enfant'}
                        </td>
                        <td className="py-2 pr-3">
                          {config.mode === 'general'
                            ? `${config.maxTokens} tk`
                            : `${config.parentMaxTokens}/${config.childMaxTokens} tk`}
                        </td>
                        <td className="py-2 pr-3">{config.overlapTokens} tk</td>
                        <td className="py-2 pr-3">{result.chunkCount}</td>
                        <td className="py-2 pr-3">
                          {result.failed ? 'échec' : `${result.score}/10`}
                        </td>
                        <td className="py-2 text-sub">{result.issues.join(' · ') || '—'}</td>
                      </tr>
                    ) : null,
                  )}
              </tbody>
            </table>
          </section>

          <section className="mt-6 rounded-xl border-2 border-red/50 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-bold">Recommandation — à reporter dans Dify</h2>
              <button
                type="button"
                onClick={onCopy}
                className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium"
              >
                {copied ? 'Copié ✓' : 'Copier'}
              </button>
            </div>
            <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-sand/50 p-3 text-[13px]">
              {state.report.recommendation.difySettings}
            </pre>
            <p className="mt-2 text-[13px] text-sub">{state.report.recommendation.rationale}</p>
            <p className="mt-3 text-[12px] text-sub">
              Tokens Claude consommés : {state.report.usage.inputTokens.toLocaleString('fr-FR')} in
              / {state.report.usage.outputTokens.toLocaleString('fr-FR')} out · Rapport éphémère —
              perdu au rechargement de la page.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Write the server shell page**

```tsx
// src/app/admin/embed-test/page.tsx
import { EmbedTestAdmin } from '@/components/admin/EmbedTestAdmin'

export const metadata = { title: "Labo d'embed — Admin" }

export default function EmbedTestPage() {
  return <EmbedTestAdmin />
}
```

- [ ] **Step 5: Add the nav link**

In `src/components/admin/AdminNav.tsx`, append to `NAV_ITEMS` (line 8-15):

```typescript
  ['/admin/embed-test', "Labo d'embed", 'settings'],
```

- [ ] **Step 6: Run tests + lint**

Run: `npx vitest run tests/components/EmbedTestAdmin.test.tsx && npm run lint`
Expected: PASS + lint clean.

- [ ] **Step 7: Commit**

```powershell
git add src/components/admin/EmbedTestAdmin.tsx src/app/admin/embed-test/page.tsx src/components/admin/AdminNav.tsx tests/components/EmbedTestAdmin.test.tsx
git commit -m "feat(embed-test): admin UI page with live timeline and Dify recommendation card"
```

---

### Task 13: Docs + final verification

**Files:**
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1: Document the env var in DEPLOY.md**

Add a short subsection near the Dify env section (§4):

```markdown
### Labo d'embed (admin)

L'outil `/admin/embed-test` appelle l'API Claude d'Anthropic (facturé à l'usage,
indépendant de Dify et de l'abonnement Claude). Poser dans l'UI Dokploy :

- `ANTHROPIC_API_KEY` — clé API console.anthropic.com.

Sans la clé, la page répond « Clé API Anthropic non configurée » (503) ; le
reste de l'application n'est pas affecté. Aucun document n'est stocké : le PDF
est traité en mémoire et le rapport est éphémère.
```

- [ ] **Step 2: Full suite + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: all tests PASS (~240+), lint clean, build succeeds.

- [ ] **Step 3: Commit**

```powershell
git add docs/DEPLOY.md
git commit -m "docs(embed-test): ANTHROPIC_API_KEY deployment notes"
```

- [ ] **Step 4: Final review**

REQUIRED SUB-SKILL: use superpowers:requesting-code-review against the spec (`docs/superpowers/specs/2026-06-06-embed-test-design.md`) before push. ⚠️ Dokploy auto-déploie au push sur main — ne pousser qu'après revue verte.
