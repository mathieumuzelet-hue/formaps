# Labo d'embed v2.1 (Config manuelle + Juge calibré + Séparateur) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (1) admin can submit ONE manual config (chunked + judged, no propose call, OCR reused); (2) the judge knows the config it evaluates + the diagnostic verdict, with explicit instructions not to penalize overlap duplication and to judge relatively on unstructured text; (3) real newlines in separators render escaped in the recommendation card and table.

**Spec:** `docs/superpowers/specs/2026-06-07-embed-test-manual-config-design.md`
**Conventions:** repo `C:\Users\mathi\formaps`, branch `feat/embed-test-manual-config`, commit per task, NEVER push, ALL commands from repo root, TDD strict. Baseline: 307 tests green, main 455ab66 + spec commit.

---

### Task 1: Pure foundations — `manual` in refine schema, `escapeSeparator`, display escape

**Files:** Modify `src/lib/embed-test/types.ts`, `src/lib/embed-test/chunker.ts`, `src/lib/embed-test/dify-settings.ts`. Tests: append to `tests/lib/embed-test-types.test.ts`, `tests/lib/embed-test-chunker.test.ts`, `tests/lib/embed-test-dify-settings.test.ts`.

- [ ] **Tests first (red):**

```typescript
// embed-test-types.test.ts — in describe('refinePayloadSchema')
test('accepts an optional manual config', () => {
  expect(
    refinePayloadSchema.safeParse({ ocr, tested: [tested], manual: valid }).success,
  ).toBe(true)
  expect(
    refinePayloadSchema.safeParse({ ocr, tested: [tested], manual: { mode: 'general' } })
      .success,
  ).toBe(false)
})

// embed-test-chunker.test.ts — new describe('escapeSeparator')
test('escapes real newlines and tabs', () => {
  expect(escapeSeparator('\n\n')).toBe('\\n\\n')
  expect(escapeSeparator('\t')).toBe('\\t')
})
test('idempotent on already-escaped forms and inert strings', () => {
  expect(escapeSeparator('\\n\\n')).toBe('\\n\\n')
  expect(escapeSeparator('###')).toBe('###')
  expect(escapeSeparator(escapeSeparator('\n'))).toBe('\\n')
})

// embed-test-dify-settings.test.ts — new test
test('renders real-newline separators in escaped form', () => {
  const out = formatDifySettings({ ...config, separator: '\n\n' }, ocrOk)
  expect(out).toContain('Délimiteur : \\n\\n')
  expect(out.split('\n').some((l) => l.trim() === '')).toBe(false) // no broken blank line
})
```

- [ ] **Implement:** `types.ts`: `manual: chunkConfigSchema.optional()` added to `refinePayloadSchema`. `chunker.ts`: export `escapeSeparator(s)` next to `normalizeSeparator`: `return s.replace(/\n/g, '\\n').replace(/\t/g, '\\t')` — an already-escaped `\\n` contains no REAL newline character, so it passes through unchanged and idempotence holds trivially. `dify-settings.ts`: wrap `config.separator` with `escapeSeparator(...)` in both mode branches (import from chunker).
- [ ] Targeted tests green; full suite; lint; commit: `feat(embed-test): manual config in refine schema + escaped separator rendering`

---

### Task 2: Judge calibration (`claude.ts`)

**Files:** Modify `src/server/embed-test/claude.ts`. Tests: modify/append `tests/server/embed-test-claude.test.ts`.

- [ ] **New signature:** `judgeConfig(client, model, config: ChunkConfig, chunks: Chunk[], diagnosticVerdict: TextDiagnostic['verdict'])` — replaces `configLabel: string`. Prompt gains, BEFORE the existing instructions:

```
--- CONFIG ÉVALUÉE ---
mode <mode>, séparateur "<escapeSeparator(separator)>", longueur max <maxTokens> tk, chevauchement <overlapTokens> tk[, parent <parentMaxTokens> / enfant <childMaxTokens> tk]

IMPORTANT : le chevauchement recopie volontairement la fin du chunk précédent au début du suivant — ces répétitions entre chunks consécutifs sont un mécanisme RAG voulu, ne les compte PAS comme défaut.
```

and, only when `diagnosticVerdict !== 'structured'`:

```
Le texte source est sans structure exploitable — note la qualité RELATIVE du compromis de découpage pour ce texte, pas l'écart à un idéal de document structuré.
```

The existing « Évalue la qualité STRUCTURELLE … config "label" » sentence keeps the label via `config.label`.

- [ ] **Tests (red first):** update existing judgeConfig test to the new signature (pass a full ChunkConfig + 'structured'); add: prompt contains 'CONFIG ÉVALUÉE', the escaped separator, 'ne les compte PAS comme défaut'; with verdict 'flat' prompt contains 'RELATIVE'; with 'structured' it does NOT contain 'RELATIVE'. Use the existing fakeClient pattern and read `client.messages.create.mock.calls[0][0].messages[0].content`.
- [ ] Targeted green (claude file ~20 tests); full suite (pipeline tests will FAIL until Task 3 updates call sites — if so, do Task 2+3 in the SAME commit; otherwise commit separately). **Decision: implement Task 2 and Task 3 together if the pipeline type-check or tests break, single commit allowed — report it.**
- [ ] Commit: `feat(embed-test): judge receives evaluated config + overlap/relative calibration`

---

### Task 3: Pipeline — manual branch + new judge call

**Files:** Modify `src/server/embed-test/pipeline.ts`. Tests: append `tests/server/embed-test-pipeline.test.ts`.

- [ ] **Implement:**
  - Judge call sites pass `(client, model, configs[i], sampleChunks(chunks), diagnostic.verdict)`.
  - Propose step becomes:

```typescript
  let configs: ChunkConfig[]
  if (refine?.manual) {
    emit({ type: 'step', id: 'propose', label: 'Config manuelle fournie — proposition sautée' })
    configs = [refine.manual]
  } else {
    // existing propose block unchanged
  }
```

- [ ] **Tests (red first):**

```typescript
test('manual config: propose never called, single judge, configs = [manual]', async () => {
  const manual = { ...config('Manuelle'), maxTokens: 1300, overlapTokens: 150 }
  const refine: RefinePayload = {
    ocr: { verdict: 'text_ok', reason: 'ok', coverage: 0.9 },
    tested: [{ config: config('A'), score: 3, issues: [], round: 1 }],
    manual,
  }
  const events = await collectRefine(refine)
  expect(proposeConfigs).not.toHaveBeenCalled()
  expect(ocrCompare).not.toHaveBeenCalled()
  expect(judgeConfig).toHaveBeenCalledTimes(1)
  const cfgs = events.find((e) => e.type === 'configs')
  expect(cfgs?.type === 'configs' && cfgs.items).toEqual([manual])
  const report = events.find((e) => e.type === 'report')
  expect(report?.type === 'report' && report.report.ranking).toEqual([0])
})

test('judge receives the evaluated config and the diagnostic verdict', async () => {
  await collect()
  const args = judgeConfig.mock.calls[0]
  expect(args[2]).toMatchObject({ label: 'A' })          // full config object
  expect(['structured', 'weakly_structured', 'flat']).toContain(args[4])
})
```

- [ ] Targeted green (pipeline 18); full suite; lint; tsc only 2 known errors. Commit: `feat(embed-test): manual-config rounds skip proposal + judge gets config context`

---

### Task 4: Hook + UI — buildManualPayload, manual form, table escape

**Files:** Modify `src/lib/embed-test/useEmbedTest.ts`, `src/components/admin/EmbedTestAdmin.tsx`. Tests: append `tests/lib/embed-test-reduce.test.ts`, `tests/components/EmbedTestAdmin.test.tsx`.

- [ ] **Hook:** export `buildManualPayload(state: EmbedTestState, config: ChunkConfig): RefinePayload | null` — `const base = buildRefinePayload(state); return base ? { ...base, manual: config } : null`.
- [ ] **UI:**
  - Table Délimiteur column renders `escapeSeparator(config.separator)` (import from chunker).
  - Collapsible « Tester ma config » block next to the Raffiner button (visible `status === 'done'`, toggle button « Tester ma config » → form): mode select Général/Parent-enfant, séparateur text input (default `\\n\\n`), longueur max + chevauchement number inputs, parent/enfant number inputs shown only in parent-child mode, 2 preprocessing checkboxes (Remplacer espaces ✓ default / Supprimer URLs ☐). Submit « Tester cette config (tour N+1) » builds `{ label: `Manuelle (${maxTokens} tk / ${overlapTokens} ov)`, mode, separator, maxTokens, overlapTokens, parentMaxTokens?, childMaxTokens?, preprocessing }`, validates with `chunkConfigSchema.safeParse` → on error show first issue mapped to a FR message inline (`<p className="text-[12.5px] text-red" role="alert">`), on success `void run(file, model, buildManualPayload(state, parsed.data)!)` (guard file + payload like onRefine; disabled without file).
  - Number inputs parse with `Number(...)`; empty → NaN → zod rejects with FR hint « Valeurs invalides — taille 100-4000, chevauchement < taille. » (single generic message is fine).
- [ ] **Tests (red first):** reducer file: `buildManualPayload` null without report / attaches manual on top of refine payload. Component file: with a done-state mockState (report + configs + results + round 1 + history + bestSoFar), the « Tester ma config » toggle is present; after `fireEvent.click` the form renders (labels Séparateur / Longueur max / Chevauchement); separator column shows escaped form when mockState configs contain a real-newline separator.
- [ ] Targeted green; full suite; lint; commit: `feat(embed-test): manual config form + escaped separator column`

---

### Task 5: Verification + final review + merge

- [ ] `npm test` (~315+), `npm run lint`, `npm run build`, `npx tsc --noEmit` (2 known errors only).
- [ ] Final review subagent vs spec (coverage + seams: manual payload client→route zod→pipeline→judge; escape applied in BOTH display sites; judge prompt blocks). READY TO SHIP required.
- [ ] PR + merge after user confirmation (⚠️ déploiement Dokploy au merge).
