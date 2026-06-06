# Labo d'embed v2 (Raffinement + Diagnostic) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two additions to the existing `/admin/embed-test` lab: (1) iterative refinement — a "Raffiner" button re-submits the same PDF with the full history of tested configs so Claude proposes a corrected wave (OCR verdict reused, no vision call); (2) deterministic structure diagnostic of the extracted text, shown as a card and injected into the proposal prompt.

**Architecture:** Everything extends the v1 modules shipped in PR #1 (main 172595a). No new route, no storage, no migration: an optional multipart `refine` JSON field on the existing route, a new pure `diagnostics.ts` module, a new `diagnostic` SSE event, client-side cumulative round history with a global-best recommendation.

**Tech Stack:** unchanged (zod v4, gpt-tokenizer, @anthropic-ai/sdk forced tool use, vitest).

**Spec:** `docs/superpowers/specs/2026-06-07-embed-test-refine-diagnostic-design.md`

**Conventions:** repo `C:\Users\mathi\formaps`, branch `feat/embed-test-refine`, commit per task, NEVER push. Run ALL commands from the repo root. TDD strictly. Code/comments in English, UI strings in French. Current baseline: 263 tests green.

---

### Task 1: Types — TestedConfig, RefinePayload, TextDiagnostic, configKey

**Files:**
- Modify: `src/lib/embed-test/types.ts`
- Test: `tests/lib/embed-test-types.test.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `tests/lib/embed-test-types.test.ts`:

```typescript
import { configKey, refinePayloadSchema } from '@/lib/embed-test/types'

describe('refinePayloadSchema', () => {
  const tested = {
    config: valid,
    score: 3.2,
    issues: ['phrases coupées'],
    round: 1,
  }
  const ocr = { verdict: 'text_ok', reason: 'ok', coverage: 0.9 }

  test('accepts a valid payload', () => {
    expect(refinePayloadSchema.safeParse({ ocr, tested: [tested] }).success).toBe(true)
  })

  test('rejects empty tested and more than 30 entries', () => {
    expect(refinePayloadSchema.safeParse({ ocr, tested: [] }).success).toBe(false)
    expect(
      refinePayloadSchema.safeParse({ ocr, tested: Array(31).fill(tested) }).success,
    ).toBe(false)
  })

  test('requires a complete ocr verdict', () => {
    expect(
      refinePayloadSchema.safeParse({ ocr: { verdict: 'text_ok' }, tested: [tested] })
        .success,
    ).toBe(false)
  })
})

describe('configKey', () => {
  test('ignores label and rationale', () => {
    expect(configKey({ ...valid, label: 'A' } as never)).toBe(
      configKey({ ...valid, label: 'B', rationale: 'x' } as never),
    )
  })

  test('distinguishes structural fields', () => {
    expect(configKey(valid as never)).not.toBe(
      configKey({ ...valid, maxTokens: 512 } as never),
    )
    expect(configKey(valid as never)).not.toBe(
      configKey({
        ...valid,
        mode: 'parent-child',
        parentMaxTokens: 2000,
        childMaxTokens: 400,
      } as never),
    )
  })
})
```

(`valid` is the existing fixture at the top of the file. Merge the new import with the existing `import { chunkConfigSchema } from '@/lib/embed-test/types'` line.)

- [ ] **Step 2:** `npx vitest run tests/lib/embed-test-types.test.ts` → FAIL (missing exports).

- [ ] **Step 3: Implement** — append to `src/lib/embed-test/types.ts` (after `ChunkConfig`):

```typescript
/**
 * Identité structurelle d'une config — utilisé pour dédupliquer les
 * propositions de Claude entre tours. Ignore label/rationale volontairement.
 */
export function configKey(c: ChunkConfig): string {
  return JSON.stringify([
    c.mode,
    c.separator,
    c.maxTokens,
    c.overlapTokens,
    c.parentMaxTokens ?? null,
    c.childMaxTokens ?? null,
    c.preprocessing.removeExtraSpaces,
    c.preprocessing.removeUrlsEmails,
  ])
}

export type TextDiagnostic = {
  totalChars: number
  /** Occurrences of \n{2,} (paragraph breaks). */
  paragraphBreaks: number
  /** Occurrences of single \n (not part of a paragraph break). */
  lineBreaks: number
  /** 0 when the text has no paragraphs. */
  avgParagraphTokens: number
  /** Lines shorter than 40 chars / non-empty lines (0..1). */
  shortLineRatio: number
  verdict: 'structured' | 'weakly_structured' | 'flat'
  notes: string[]
}

export const testedConfigSchema = z.object({
  config: chunkConfigSchema,
  score: z.number(),
  issues: z.array(z.string()),
  failed: z.boolean().optional(),
  round: z.number().int().min(1),
})
export type TestedConfig = z.infer<typeof testedConfigSchema>

export const refinePayloadSchema = z.object({
  ocr: z.object({
    verdict: z.enum(['text_ok', 'ocr_needed']),
    reason: z.string(),
    coverage: z.number().min(0).max(1),
  }),
  tested: z.array(testedConfigSchema).min(1).max(30),
})
export type RefinePayload = z.infer<typeof refinePayloadSchema>
```

And extend the event union (add the variant BEFORE `error`):

```typescript
export type EmbedTestEvent =
  | { type: 'step'; id: string; label: string }
  | { type: 'configs'; items: ChunkConfig[] }
  | { type: 'config-result'; result: ConfigResult }
  | { type: 'diagnostic'; diagnostic: TextDiagnostic }
  | { type: 'report'; report: EmbedTestReport }
  | { type: 'error'; code: string; message: string }
```

- [ ] **Step 4:** test file → PASS. **Step 5:** Full suite + commit:

```powershell
git add src/lib/embed-test/types.ts tests/lib/embed-test-types.test.ts
git commit -m "feat(embed-test): refine payload schema, config identity key, diagnostic types"
```

---

### Task 2: Diagnostics module (`diagnostics.ts`)

**Files:**
- Create: `src/lib/embed-test/diagnostics.ts`
- Test: `tests/lib/embed-test-diagnostics.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/lib/embed-test-diagnostics.test.ts
import { describe, expect, test } from 'vitest'

import {
  analyzeTextStructure,
  diagnosticPromptSummary,
} from '@/lib/embed-test/diagnostics'

const PARA = 'Une phrase de longueur raisonnable pour un paragraphe de test métier.'

describe('analyzeTextStructure', () => {
  test('structured text → structured verdict with positive note', () => {
    const text = `${PARA}\n\n${PARA}\n\n${PARA}`
    const d = analyzeTextStructure(text)
    expect(d.verdict).toBe('structured')
    expect(d.paragraphBreaks).toBe(2)
    expect(d.avgParagraphTokens).toBeGreaterThan(0)
    expect(d.notes.some((n) => n.includes('bien structuré'))).toBe(true)
  })

  test('no paragraph breaks → flat with explanatory note', () => {
    const text = 'mot '.repeat(300).trim()
    const d = analyzeTextStructure(text)
    expect(d.verdict).toBe('flat')
    expect(d.paragraphBreaks).toBe(0)
    expect(d.notes.some((n) => n.includes('Aucun saut de paragraphe'))).toBe(true)
  })

  test('very long paragraphs → weakly_structured', () => {
    const long = 'mot '.repeat(600).trim() // ~600 tokens, > 500
    const text = `${long}\n\n${long}`
    const d = analyzeTextStructure(text)
    expect(d.verdict).toBe('weakly_structured')
    expect(d.notes.some((n) => n.includes('Paragraphes très longs'))).toBe(true)
  })

  test('majority of short lines → weakly_structured with table note', () => {
    const shortLines = Array(20).fill('Réf 123 | 4,99 €').join('\n')
    const text = `${PARA}\n\n${shortLines}`
    const d = analyzeTextStructure(text)
    expect(d.shortLineRatio).toBeGreaterThan(0.5)
    expect(d.verdict).toBe('weakly_structured')
    expect(d.notes.some((n) => n.includes('lignes courtes'))).toBe(true)
  })

  test('empty text → flat, zeroed metrics', () => {
    const d = analyzeTextStructure('')
    expect(d.verdict).toBe('flat')
    expect(d.totalChars).toBe(0)
    expect(d.avgParagraphTokens).toBe(0)
    expect(d.shortLineRatio).toBe(0)
  })
})

describe('diagnosticPromptSummary', () => {
  test('renders verdict, metrics and notes in French', () => {
    const d = analyzeTextStructure(`${PARA}\n\n${PARA}`)
    const out = diagnosticPromptSummary(d)
    expect(out).toContain('Verdict')
    expect(out).toContain('sauts de paragraphe')
    for (const note of d.notes) expect(out).toContain(note)
  })
})
```

- [ ] **Step 2:** run → FAIL. **Step 3: Implement**

```typescript
// src/lib/embed-test/diagnostics.ts
/**
 * Deterministic structure analysis of the extracted PDF text. Explains WHY
 * chunking scores plateau (no paragraph breaks, table-like lines, …) and
 * feeds the proposal prompt so Claude picks fitting separators. Pure module.
 */
import { countTokens } from '@/lib/embed-test/chunker'
import type { TextDiagnostic } from '@/lib/embed-test/types'

const SHORT_LINE_CHARS = 40
const LONG_PARAGRAPH_TOKENS = 500
const SHORT_LINE_RATIO_LIMIT = 0.5

export function analyzeTextStructure(text: string): TextDiagnostic {
  const totalChars = text.length
  const paragraphBreaks = (text.match(/\n{2,}/g) ?? []).length
  const lineBreaks = (text.match(/(?<!\n)\n(?!\n)/g) ?? []).length

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const avgParagraphTokens =
    paragraphs.length === 0
      ? 0
      : Math.round(
          paragraphs.reduce((sum, p) => sum + countTokens(p), 0) / paragraphs.length,
        )
  const shortLineRatio =
    lines.length === 0
      ? 0
      : lines.filter((l) => l.length < SHORT_LINE_CHARS).length / lines.length

  const notes: string[] = []
  if (paragraphBreaks === 0) {
    notes.push(
      'Aucun saut de paragraphe (\\n\\n) détecté — les séparateurs paragraphe ne ' +
        'matcheront jamais, préférez \\n ou un découpage par phrases.',
    )
  }
  if (avgParagraphTokens > LONG_PARAGRAPH_TOKENS) {
    notes.push(
      `Paragraphes très longs (~${avgParagraphTokens} tokens en moyenne) — ils ` +
        'seront re-découpés brutalement par tokens.',
    )
  }
  if (shortLineRatio > SHORT_LINE_RATIO_LIMIT) {
    notes.push(
      'Majorité de lignes courtes — texte probablement issu d’un tableau ou ' +
        'd’une mise en page colonne, structure peu fiable.',
    )
  }

  let verdict: TextDiagnostic['verdict']
  if (paragraphBreaks === 0) {
    verdict = 'flat'
  } else if (
    avgParagraphTokens > LONG_PARAGRAPH_TOKENS ||
    shortLineRatio > SHORT_LINE_RATIO_LIMIT
  ) {
    verdict = 'weakly_structured'
  } else {
    verdict = 'structured'
  }
  if (verdict === 'structured') {
    notes.push('Texte bien structuré — les séparateurs paragraphe devraient fonctionner.')
  }

  return {
    totalChars,
    paragraphBreaks,
    lineBreaks,
    avgParagraphTokens,
    shortLineRatio,
    verdict,
    notes,
  }
}

const VERDICT_LABELS: Record<TextDiagnostic['verdict'], string> = {
  structured: 'texte bien structuré',
  weakly_structured: 'texte peu structuré',
  flat: 'texte plat (aucune structure de paragraphe)',
}

/** Compact French rendering for the proposal prompt. */
export function diagnosticPromptSummary(d: TextDiagnostic): string {
  return [
    `Verdict : ${VERDICT_LABELS[d.verdict]}.`,
    `Métriques : ${d.paragraphBreaks} sauts de paragraphe, ` +
      `~${d.avgParagraphTokens} tokens/paragraphe, ` +
      `${Math.round(d.shortLineRatio * 100)} % de lignes courtes, ` +
      `${d.totalChars} caractères.`,
    ...d.notes.map((n) => `- ${n}`),
  ].join('\n')
}
```

- [ ] **Step 4:** test file → PASS (6 tests). **Step 5:** full suite + commit:

```powershell
git add src/lib/embed-test/diagnostics.ts tests/lib/embed-test-diagnostics.test.ts
git commit -m "feat(embed-test): deterministic text-structure diagnostic"
```

---

### Task 3: Parse — diagnostic event variant

**Files:**
- Modify: `src/lib/embed-test/parse.ts`
- Test: `tests/lib/embed-test-parse.test.ts` (append)

- [ ] **Step 1: Failing tests** — append:

```typescript
test('parses a diagnostic event', () => {
  const diagnostic = {
    totalChars: 1200,
    paragraphBreaks: 4,
    lineBreaks: 10,
    avgParagraphTokens: 80,
    shortLineRatio: 0.1,
    verdict: 'structured',
    notes: ['Texte bien structuré'],
  }
  const ev = parseEmbedTestEvent(JSON.stringify({ type: 'diagnostic', diagnostic }))
  expect(ev?.type).toBe('diagnostic')
})

test('rejects a diagnostic event with unknown verdict', () => {
  expect(
    parseEmbedTestEvent(
      JSON.stringify({ type: 'diagnostic', diagnostic: { verdict: 'great' } }),
    ),
  ).toBeNull()
})
```

- [ ] **Step 2:** run → FAIL. **Step 3: Implement** — add to the `eventSchema` discriminated union in `src/lib/embed-test/parse.ts` (before the `report` variant):

```typescript
  z.object({
    type: z.literal('diagnostic'),
    diagnostic: z.object({
      totalChars: z.number(),
      paragraphBreaks: z.number(),
      lineBreaks: z.number(),
      avgParagraphTokens: z.number(),
      shortLineRatio: z.number(),
      verdict: z.enum(['structured', 'weakly_structured', 'flat']),
      notes: z.array(z.string()),
    }),
  }),
```

- [ ] **Step 4:** PASS (6 tests). **Step 5:** commit:

```powershell
git add src/lib/embed-test/parse.ts tests/lib/embed-test-parse.test.ts
git commit -m "feat(embed-test): diagnostic SSE event parsing"
```

---

### Task 4: Claude — refine-aware proposeConfigs

**Files:**
- Modify: `src/server/embed-test/claude.ts`
- Test: `tests/server/embed-test-claude.test.ts` (append/modify)

- [ ] **Step 1: Failing tests** — append (reuse `fakeClient` and `validConfig` fixtures; import `vi` already present):

```typescript
describe('proposeConfigs — refine extras', () => {
  const tested = [
    {
      config: { ...validConfig, label: 'Tour1' },
      score: 3.2,
      issues: ['phrases coupées p.2'],
      round: 1,
    },
  ]

  test('prompt contains diagnostic and history blocks when provided', async () => {
    const client = fakeClient({ configs: [validConfig, { ...validConfig, maxTokens: 512 }] })
    await proposeConfigs(
      client,
      'claude-sonnet-4-6',
      'texte',
      { totalPages: 1, totalChars: 10 },
      { diagnosticSummary: 'Verdict : texte plat.', tested },
    )
    const params = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const prompt = (params as { messages: Array<{ content: string }> }).messages[0].content
    expect(prompt).toContain('DIAGNOSTIC DU TEXTE EXTRAIT')
    expect(prompt).toContain('Verdict : texte plat.')
    expect(prompt).toContain('CONFIGS DÉJÀ TESTÉES')
    expect(prompt).toContain('Tour1')
    expect(prompt).toContain('3.2/10')
    expect(prompt).toContain('phrases coupées p.2')
    expect(prompt).toContain('NOUVELLES')
  })

  test('drops re-proposed configs identical to already-tested ones', async () => {
    // Claude re-proposes the tested config (different label) + 2 new ones.
    const client = fakeClient({
      configs: [
        { ...validConfig, label: 'copie déguisée' },
        { ...validConfig, maxTokens: 512 },
        { ...validConfig, maxTokens: 2000 },
      ],
    })
    const res = await proposeConfigs(
      client,
      'claude-sonnet-4-6',
      'texte',
      { totalPages: 1, totalChars: 10 },
      { tested },
    )
    expect(res.data).toHaveLength(2)
    expect(res.data.map((c) => c.maxTokens)).toEqual([512, 2000])
  })

  test('throws when fewer than 2 NEW configs survive dedup', async () => {
    const client = fakeClient({
      configs: [
        { ...validConfig, label: 'copie' },
        { ...validConfig, maxTokens: 512 },
      ],
    })
    await expect(
      proposeConfigs(
        client,
        'claude-sonnet-4-6',
        'texte',
        { totalPages: 1, totalChars: 10 },
        { tested },
      ),
    ).rejects.toThrow(/fewer than 2 valid configs/)
  })

  test('without extras, behavior is unchanged (no blocks in prompt)', async () => {
    const client = fakeClient({ configs: [validConfig, { ...validConfig, maxTokens: 512 }] })
    await proposeConfigs(client, 'claude-sonnet-4-6', 'texte', {
      totalPages: 1,
      totalChars: 10,
    })
    const params = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const prompt = (params as { messages: Array<{ content: string }> }).messages[0].content
    expect(prompt).not.toContain('DIAGNOSTIC DU TEXTE EXTRAIT')
    expect(prompt).not.toContain('CONFIGS DÉJÀ TESTÉES')
  })
})
```

- [ ] **Step 2:** run → FAIL. **Step 3: Implement** in `src/server/embed-test/claude.ts`:

Add imports: `configKey`, `type TestedConfig` from `@/lib/embed-test/types`.

Add a private renderer above `proposeConfigs`:

```typescript
function renderTestedConfig(t: TestedConfig): string {
  const sizes =
    t.config.mode === 'general'
      ? `${t.config.maxTokens} tk, overlap ${t.config.overlapTokens}`
      : `parent ${t.config.parentMaxTokens} / enfant ${t.config.childMaxTokens} tk`
  const outcome = t.failed ? 'échec' : `${t.score}/10`
  const issues = t.issues.length > 0 ? ` — problèmes : ${t.issues.join(' ; ')}` : ''
  return `- [tour ${t.round}] "${t.config.label}" (${t.config.mode}, sep "${t.config.separator}", ${sizes}) → ${outcome}${issues}`
}
```

Change the signature and prompt assembly of `proposeConfigs`:

```typescript
export async function proposeConfigs(
  client: AnthropicLike,
  model: string,
  textSample: string,
  stats: { totalPages: number; totalChars: number },
  extras?: { diagnosticSummary?: string; tested?: TestedConfig[] },
): Promise<{ data: ChunkConfig[]; usage: Usage }> {
  const diagnosticBlock = extras?.diagnosticSummary
    ? `--- DIAGNOSTIC DU TEXTE EXTRAIT ---\n${extras.diagnosticSummary}\n\n`
    : ''
  const testedBlock =
    extras?.tested && extras.tested.length > 0
      ? '--- CONFIGS DÉJÀ TESTÉES (ne JAMAIS re-proposer une config identique) ---\n' +
        extras.tested.map(renderTestedConfig).join('\n') +
        '\n\nPropose des configurations NOUVELLES qui corrigent les problèmes relevés ci-dessus.\n\n'
      : ''
  const { input, usage } = await forcedToolCall(
    client,
    model,
    "Tu prépares l'ingestion d'un document dans une base de connaissance Dify (RAG). " +
      'Analyse la structure du texte ci-dessous (titres, paragraphes, listes, tableaux, ' +
      `densité). Document : ${stats.totalPages} pages, ${stats.totalChars} caractères. ` +
      'Propose 4 à 6 configurations de chunking PERTINENTES et CONTRASTÉES à tester, ' +
      "alignées sur les options de l'UI Dify (mode Général ou Parent-enfant, délimiteur, " +
      'longueur max en tokens 100-4000, chevauchement < longueur max, prétraitement). ' +
      'En mode parent-child, fournis parentMaxTokens et childMaxTokens.\n\n' +
      diagnosticBlock +
      testedBlock +
      '--- DOCUMENT ---\n' +
      textSample,
    'output',
    'Rapporte les configurations de chunking à tester',
    PROPOSE_TOOL_SCHEMA,
  )
  // existing per-config safeParse tolerance loop, then dedup vs tested:
  const testedKeys = new Set((extras?.tested ?? []).map((t) => configKey(t.config)))
  const fresh = valid.filter((c) => !testedKeys.has(configKey(c)))
  const capped = fresh.slice(0, 6)
  if (capped.length < 2) throw new Error('Claude proposed fewer than 2 valid configs')
  return { data: capped, usage }
}
```

(Adapt to the actual current body: the safeParse loop variable holding survivors is reused; insert dedup BETWEEN the safeParse loop and the existing slice/throw, keeping a single slice/throw.)

- [ ] **Step 4:** test file → PASS (12 tests). **Step 5:** full suite + lint + commit:

```powershell
git add src/server/embed-test/claude.ts tests/server/embed-test-claude.test.ts
git commit -m "feat(embed-test): refine-aware config proposal (diagnostic + history + dedup)"
```

---

### Task 5: Pipeline — refine param + diagnostic event

**Files:**
- Modify: `src/server/embed-test/pipeline.ts`
- Test: `tests/server/embed-test-pipeline.test.ts` (append/modify)

- [ ] **Step 1: Failing tests** — append (fixtures `config`, `usage`, mocks exist; `collect()` helper takes no args — add a variant):

```typescript
async function collectRefine(refine: RefinePayload): Promise<EmbedTestEvent[]> {
  const events: EmbedTestEvent[] = []
  await runEmbedTest(new Uint8Array([0]), 'sonnet', (e) => events.push(e), refine)
  return events
}

describe('runEmbedTest — diagnostic & refine', () => {
  test('every run emits a diagnostic event after extraction', async () => {
    const events = await collect()
    const diag = events.find((e) => e.type === 'diagnostic')
    expect(diag).toBeDefined()
    if (diag?.type === 'diagnostic') {
      expect(diag.diagnostic.totalChars).toBeGreaterThan(0)
      expect(['structured', 'weakly_structured', 'flat']).toContain(
        diag.diagnostic.verdict,
      )
    }
    // diagnostic arrives before the configs event
    const types = events.map((e) => e.type)
    expect(types.indexOf('diagnostic')).toBeLessThan(types.indexOf('configs'))
  })

  test('proposeConfigs receives diagnostic summary in extras on every run', async () => {
    await collect()
    const extras = proposeConfigs.mock.calls[0][4] as {
      diagnosticSummary?: string
      tested?: unknown[]
    }
    expect(extras.diagnosticSummary).toContain('Verdict')
    expect(extras.tested).toBeUndefined()
  })

  test('refine run: ocrCompare and buildPdfSample are never called, verdict reused', async () => {
    const refine: RefinePayload = {
      ocr: { verdict: 'ocr_needed', reason: 'scanné (tour 1)', coverage: 0.1 },
      tested: [
        { config: config('A'), score: 2.5, issues: ['coupé'], round: 1 },
      ],
    }
    const events = await collectRefine(refine)
    expect(ocrCompare).not.toHaveBeenCalled()
    expect(buildPdfSample).not.toHaveBeenCalled()
    const report = events.find((e) => e.type === 'report')
    if (report?.type === 'report') {
      expect(report.report.ocr.verdict).toBe('ocr_needed')
      expect(report.report.ocr.reason).toBe('scanné (tour 1)')
      // usage: 1 propose + 2 judges only (no ocr call)
      expect(report.report.usage).toEqual({ inputTokens: 30, outputTokens: 15 })
    }
    const ocrStep = events.find(
      (e) => e.type === 'step' && e.id === 'ocr',
    )
    expect(ocrStep?.type === 'step' && ocrStep.label).toContain('réutilisé')
    const extras = proposeConfigs.mock.calls[0][4] as { tested?: unknown[] }
    expect(extras.tested).toHaveLength(1)
  })
})
```

Add `RefinePayload` to the type imports of the test file.

- [ ] **Step 2:** run → FAIL. **Step 3: Implement** in `src/server/embed-test/pipeline.ts`:

- Imports: `analyzeTextStructure`, `diagnosticPromptSummary` from `@/lib/embed-test/diagnostics`; `type RefinePayload` from types.
- Signature: `export async function runEmbedTest(buffer, modelKey, emit, refine?: RefinePayload)`.
- After `const fullText = pages.join('\n\n')`:

```typescript
  const diagnostic = analyzeTextStructure(fullText)
  emit({ type: 'diagnostic', diagnostic })
```

- OCR step becomes:

```typescript
  let ocr: OcrVerdict
  if (refine) {
    emit({ type: 'step', id: 'ocr', label: 'Verdict OCR réutilisé (tour précédent)' })
    ocr = refine.ocr
  } else {
    emit({ type: 'step', id: 'ocr', label: 'Comparaison OCR vs extraction texte…' })
    // existing try/catch block unchanged
  }
```

- Propose call gains the 5th argument:

```typescript
    const res = await proposeConfigs(
      client,
      model,
      fullText.slice(0, MAX_ANALYSIS_CHARS),
      { totalPages, totalChars: fullText.length },
      { diagnosticSummary: diagnosticPromptSummary(diagnostic), tested: refine?.tested },
    )
```

Note: when `refine?.tested` is undefined the extras object still carries the diagnostic — that's the spec (diagnostic injected on EVERY run). The Task 5 test asserts `extras.tested` is undefined on a plain run.

- [ ] **Step 4:** test file → PASS (14 tests). **Step 5:** full suite + commit:

```powershell
git add src/server/embed-test/pipeline.ts tests/server/embed-test-pipeline.test.ts
git commit -m "feat(embed-test): pipeline refine mode (reused ocr verdict) + diagnostic event"
```

---

### Task 6: Route — optional `refine` field

**Files:**
- Modify: `src/app/api/admin/embed-test/route.ts`
- Test: `tests/server/embed-test-route.test.ts` (append)

- [ ] **Step 1: Failing tests** — append (extend `makeRequest` with `refine?: string`):

```typescript
// in makeRequest opts: { file?: File | null; model?: string; refine?: string }
// and in the body: if (opts?.refine) form.set('refine', opts.refine)

const validRefine = JSON.stringify({
  ocr: { verdict: 'text_ok', reason: 'ok', coverage: 0.9 },
  tested: [
    {
      config: {
        label: 'A',
        mode: 'general',
        separator: '\\n\\n',
        maxTokens: 1024,
        overlapTokens: 0,
        preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
      },
      score: 3,
      issues: [],
      round: 1,
    },
  ],
})

describe('POST /api/admin/embed-test — refine', () => {
  test('valid refine payload is forwarded to the pipeline', async () => {
    await (await POST(makeRequest({ refine: validRefine }))).text()
    expect(runEmbedTest).toHaveBeenCalledWith(
      expect.anything(),
      'sonnet',
      expect.any(Function),
      expect.objectContaining({ ocr: expect.objectContaining({ verdict: 'text_ok' }) }),
    )
  })

  test('absent refine → pipeline called without payload', async () => {
    await (await POST(makeRequest())).text()
    expect(runEmbedTest).toHaveBeenCalledWith(
      expect.anything(),
      'sonnet',
      expect.any(Function),
      undefined,
    )
  })

  test('malformed refine JSON → 400', async () => {
    const res = await POST(makeRequest({ refine: '{oops' }))
    expect(res.status).toBe(400)
    expect(runEmbedTest).not.toHaveBeenCalled()
  })

  test('schema-invalid refine → 400', async () => {
    const res = await POST(makeRequest({ refine: JSON.stringify({ tested: [] }) }))
    expect(res.status).toBe(400)
  })

  test('oversize refine (> 64 KB) → 400', async () => {
    const res = await POST(makeRequest({ refine: 'x'.repeat(64 * 1024 + 1) }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2:** run → FAIL. **Step 3: Implement** in `route.ts`:

Import `refinePayloadSchema, type RefinePayload` from types. Inside the existing form try-block, after model validation:

```typescript
    const rawRefine = form.get('refine')
    if (rawRefine != null && rawRefine !== '') {
      if (typeof rawRefine !== 'string' || rawRefine.length > 64 * 1024) {
        return json({ error: 'invalid_refine' }, 400)
      }
      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(rawRefine)
      } catch {
        return json({ error: 'invalid_refine' }, 400)
      }
      const parsed = refinePayloadSchema.safeParse(parsedJson)
      if (!parsed.success) return json({ error: 'invalid_refine' }, 400)
      refine = parsed.data
    }
```

(declare `let refine: RefinePayload | undefined` next to `file`/`model`) and pass it: `await runEmbedTest(buffer, model, emit, refine)`.

- [ ] **Step 4:** test file → PASS (16 tests). **Step 5:** full suite + commit:

```powershell
git add src/app/api/admin/embed-test/route.ts tests/server/embed-test-route.test.ts
git commit -m "feat(embed-test): optional validated refine field on the SSE route"
```

---

### Task 7: Hook — rounds, history, bestSoFar, buildRefinePayload

**Files:**
- Modify: `src/lib/embed-test/useEmbedTest.ts`
- Test: `tests/lib/embed-test-reduce.test.ts` (append/modify)

- [ ] **Step 1: Failing tests** — append:

```typescript
import { buildRefinePayload } from '@/lib/embed-test/useEmbedTest'

const diagnostic = {
  totalChars: 100,
  paragraphBreaks: 2,
  lineBreaks: 5,
  avgParagraphTokens: 50,
  shortLineRatio: 0.1,
  verdict: 'structured' as const,
  notes: [],
}

const makeReport = (score: number) => ({
  ocr: { verdict: 'text_ok' as const, reason: 'r', coverage: 0.9 },
  ranking: [0],
  recommendation: { configIndex: 0, difySettings: 's', rationale: `score ${score}` },
  usage: { inputTokens: 1, outputTokens: 2 },
})

describe('applyEvent — v2', () => {
  test('diagnostic event is stored', () => {
    const state = run([{ type: 'diagnostic', diagnostic }])
    expect(state.diagnostic).toEqual(diagnostic)
  })

  test('report appends the round to history and sets bestSoFar', () => {
    const state = [
      { type: 'configs' as const, items: [config] },
      {
        type: 'config-result' as const,
        result: { index: 0, score: 4, issues: ['x'], summary: 's', chunkCount: 3 },
      },
      { type: 'report' as const, report: makeReport(4) },
    ].reduce(applyEvent, { ...initialState, status: 'running' as const, round: 1 })
    expect(state.history).toHaveLength(1)
    expect(state.history[0]).toMatchObject({ score: 4, round: 1 })
    expect(state.bestSoFar?.score).toBe(4)
    expect(state.bestSoFar?.round).toBe(1)
  })

  test('a worse later round does not displace bestSoFar', () => {
    const round1 = [
      { type: 'configs' as const, items: [config] },
      {
        type: 'config-result' as const,
        result: { index: 0, score: 7, issues: [], summary: 's', chunkCount: 3 },
      },
      { type: 'report' as const, report: makeReport(7) },
    ].reduce(applyEvent, { ...initialState, status: 'running' as const, round: 1 })
    // simulate the hook's run() carry-over into round 2
    const round2Start = {
      ...initialState,
      status: 'running' as const,
      round: 2,
      history: round1.history,
      bestSoFar: round1.bestSoFar,
    }
    const round2 = [
      { type: 'configs' as const, items: [config] },
      {
        type: 'config-result' as const,
        result: { index: 0, score: 3, issues: [], summary: 's', chunkCount: 3 },
      },
      { type: 'report' as const, report: makeReport(3) },
    ].reduce(applyEvent, round2Start)
    expect(round2.history).toHaveLength(2)
    expect(round2.bestSoFar?.score).toBe(7)
    expect(round2.bestSoFar?.round).toBe(1)
  })
})

describe('buildRefinePayload', () => {
  test('null without a report', () => {
    expect(buildRefinePayload(initialState)).toBeNull()
  })

  test('builds ocr + last 30 tested entries', () => {
    const state = [
      { type: 'configs' as const, items: [config] },
      {
        type: 'config-result' as const,
        result: { index: 0, score: 4, issues: [], summary: 's', chunkCount: 3 },
      },
      { type: 'report' as const, report: makeReport(4) },
    ].reduce(applyEvent, { ...initialState, status: 'running' as const, round: 1 })
    const payload = buildRefinePayload(state)
    expect(payload?.ocr.verdict).toBe('text_ok')
    expect(payload?.tested).toHaveLength(1)
  })
})
```

- [ ] **Step 2:** run → FAIL. **Step 3: Implement** in `useEmbedTest.ts`:

- State type and `initialState` gain: `diagnostic: TextDiagnostic | null` (null), `round: number` (0), `history: TestedConfig[]` ([]), `bestSoFar: { config: ChunkConfig; score: number; rationale: string; round: number; ocr: OcrVerdict } | null` (null). Import the new types.
- Reducer:

```typescript
    case 'diagnostic':
      return { ...state, diagnostic: event.diagnostic }
    case 'report': {
      const tested: TestedConfig[] = state.results.flatMap((r) => {
        const cfg = state.configs[r.index]
        if (!cfg) return []
        return [
          {
            config: cfg,
            score: r.score,
            issues: r.issues,
            ...(r.failed ? { failed: true as const } : {}),
            round: state.round,
          },
        ]
      })
      const bestIdx = event.report.recommendation.configIndex
      const bestResult = state.results.find((r) => r.index === bestIdx)
      const bestConfig = state.configs[bestIdx]
      const candidate =
        bestConfig && bestResult
          ? {
              config: bestConfig,
              score: bestResult.score,
              rationale: event.report.recommendation.rationale,
              round: state.round,
              ocr: event.report.ocr,
            }
          : null
      const bestSoFar =
        candidate && (!state.bestSoFar || candidate.score > state.bestSoFar.score)
          ? candidate
          : state.bestSoFar
      return {
        ...state,
        report: event.report,
        status: 'done',
        history: [...state.history, ...tested],
        bestSoFar,
      }
    }
```

- `run(file, model, refine?: RefinePayload)`: start-of-run state preserves the carry-over:

```typescript
    setState((prev) => ({
      ...initialState,
      status: 'running',
      round: prev.round + 1,
      history: prev.history,
      bestSoFar: prev.bestSoFar,
    }))
```

and the FormData gains `if (refine) form.set('refine', JSON.stringify(refine))`.

- Exported pure helper:

```typescript
/** Refine payload for the next round — null until a report exists. */
export function buildRefinePayload(state: EmbedTestState): RefinePayload | null {
  if (!state.report || state.history.length === 0) return null
  return { ocr: state.report.ocr, tested: state.history.slice(-30) }
}
```

- `reset()` already returns `initialState` (full zero) — unchanged.

- [ ] **Step 4:** test file → PASS (8 tests). **Step 5:** full suite + commit:

```powershell
git add src/lib/embed-test/useEmbedTest.ts tests/lib/embed-test-reduce.test.ts
git commit -m "feat(embed-test): cumulative rounds, global best and refine payload in hook"
```

---

### Task 8: UI — diagnostic card, Raffiner button, global best

**Files:**
- Modify: `src/components/admin/EmbedTestAdmin.tsx`
- Test: `tests/components/EmbedTestAdmin.test.tsx` (append)

- [ ] **Step 1: Failing test** — append a second mock-driven test (the file mocks `useEmbedTest` via importOriginal; extend the mock to make state injectable):

Replace the existing `vi.mock` with an injectable version:

```typescript
let mockState: import('@/lib/embed-test/useEmbedTest').EmbedTestState | undefined
vi.mock('@/lib/embed-test/useEmbedTest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/embed-test/useEmbedTest')>()
  return {
    ...actual,
    // mockState is read at RENDER time (after module init) — never assign it
    // inside this hoisted factory (TDZ trap with `let`).
    useEmbedTest: () => ({
      state: mockState ?? actual.initialState,
      run: vi.fn(),
      reset: vi.fn(),
    }),
  }
})

afterEach(() => {
  mockState = undefined
})
```

(each test may assign `mockState` before `render`; default = initialState). Add:

```typescript
test('renders the diagnostic card when a diagnostic is present', async () => {
  const { initialState } = await import('@/lib/embed-test/useEmbedTest')
  mockState = {
    ...initialState,
    status: 'running',
    diagnostic: {
      totalChars: 1000,
      paragraphBreaks: 0,
      lineBreaks: 12,
      avgParagraphTokens: 800,
      shortLineRatio: 0.2,
      verdict: 'flat',
      notes: ['Aucun saut de paragraphe (\\n\\n) détecté'],
    },
  }
  render(<EmbedTestAdmin />)
  expect(screen.getByText(/Structure du texte extrait/i)).toBeInTheDocument()
  expect(screen.getByText(/Plat/i)).toBeInTheDocument()
  expect(screen.getByText(/Aucun saut de paragraphe/i)).toBeInTheDocument()
})
```

- [ ] **Step 2:** run → FAIL. **Step 3: Implement** in `EmbedTestAdmin.tsx`:

- Imports: `buildRefinePayload` from the hook module, `formatDifySettings` from `@/lib/embed-test/dify-settings`.
- **Diagnostic card** (between the timeline section and the error section):

```tsx
      {state.diagnostic && (
        <section className="mt-6 rounded-xl border border-line bg-white p-5">
          <h2 className="text-[15px] font-bold">Structure du texte extrait</h2>
          <p className="mt-1 text-[14px]">
            {state.diagnostic.verdict === 'structured' && '✅ Structuré'}
            {state.diagnostic.verdict === 'weakly_structured' && '⚠️ Peu structuré'}
            {state.diagnostic.verdict === 'flat' && '🚫 Plat'}
            <span className="ml-2 text-[12.5px] text-sub">
              {state.diagnostic.paragraphBreaks} sauts de paragraphe ·{' '}
              ~{state.diagnostic.avgParagraphTokens} tokens/paragraphe ·{' '}
              {Math.round(state.diagnostic.shortLineRatio * 100)} % de lignes courtes
            </span>
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-[13px] text-sub">
            {state.diagnostic.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
```

- **Recommendation = global best.** Before the return, compute:

```tsx
  const globalBest = state.bestSoFar
  const recommendedText =
    globalBest != null
      ? formatDifySettings(globalBest.config, globalBest.ocr)
      : (state.report?.recommendation.difySettings ?? '')
  const bestFromOtherRound =
    globalBest != null && state.report != null && globalBest.round !== state.round
```

`onCopy` copies `recommendedText`. The recommendation card title becomes:

```tsx
              <h2 className="text-[15px] font-bold">
                {bestFromOtherRound
                  ? `Recommandation — meilleure config (tour ${globalBest!.round})`
                  : 'Recommandation — à reporter dans Dify'}
              </h2>
```

the `<pre>` renders `{recommendedText}`, the rationale renders `{globalBest?.rationale ?? state.report.recommendation.rationale}`.

- **Tour badge + Raffiner.** Table card heading becomes `Configurations testées — Tour {state.round}` with, when `state.round > 1`, a subtitle `<p className="mt-1 text-[12.5px] text-sub">{state.history.length} configs testées au total</p>`. In the recommendation card (under the pre), add:

```tsx
            {state.status === 'done' && (
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onRefine}
                  disabled={!file || running}
                  className="rounded-lg bg-red px-4 py-2 text-[14px] font-bold text-white disabled:opacity-40"
                >
                  Raffiner (tour {state.round + 1})
                </button>
                {!file && (
                  <p className="text-[12.5px] text-sub">
                    Resélectionnez le PDF pour raffiner.
                  </p>
                )}
              </div>
            )}
```

with the handler:

```tsx
  const onRefine = () => {
    const payload = buildRefinePayload(state)
    if (!file || !payload) return
    setCopied(false)
    void run(file, model, payload)
  }
```

- **File change resets the session**: the file input `onChange` becomes:

```tsx
              onChange={(e) => {
                reset()
                setFile(e.target.files?.[0] ?? null)
              }}
```

- [ ] **Step 4:** component tests → PASS (3 tests). **Step 5:** full suite + lint + commit:

```powershell
git add src/components/admin/EmbedTestAdmin.tsx tests/components/EmbedTestAdmin.test.tsx
git commit -m "feat(embed-test): diagnostic card, refine button, cross-round best recommendation"
```

---

### Task 9: Full verification + final review

- [ ] **Step 1:** `npm test` → ~285+ tests green, zero regression. `npm run lint` → clean. `npm run build` → succeeds.
- [ ] **Step 2:** `npx tsc --noEmit` → only the 2 known pre-existing errors (tests/server/admin-users-password.test.ts).
- [ ] **Step 3:** Final review subagent against the spec (`docs/superpowers/specs/2026-06-07-embed-test-refine-diagnostic-design.md`) — spec coverage sweep + integration seams (pipeline emits ↔ parse schema ↔ hook reducer ↔ UI), READY TO SHIP verdict required before merge.
- [ ] **Step 4:** Merge via PR (⚠️ le merge dans main déclenche l'auto-déploiement Dokploy).
