# embed-lab polish + hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clore le dernier PR de la roadmap d'audit (item 7) — robustesse du labo d'embed et durcissement des uploads.

**Architecture:** Corrections ciblées et indépendantes dans `src/lib/embed-test/*`, `src/server/embed-test/*`, les routes d'upload PDF et le schéma DB. Aucun changement de comportement sur les chemins nominaux ; chaque tâche est testée en isolation (vitest, fakes existants).

**Tech Stack:** Next.js (version modifiée — lire `node_modules/next/dist/docs/` avant tout code Next.js), TypeScript, zod, Drizzle (Postgres), Anthropic SDK, vitest, gpt-tokenizer, `node:crypto`.

## Global Constraints

- Toutes les réponses/labels utilisateur en **français** ; code et messages de commit en anglais.
- TDD strict : test rouge → impl minimale → vert → commit. Un commit par tâche.
- Baseline avant travaux : **528 tests verts**, main `3ece616`, branche `feat/embed-lab-polish` (spec `0410d4c`).
- Vérif pré-fini globale : `pnpm lint && pnpm typecheck && pnpm test` tous verts.
- Ne JAMAIS s'appuyer sur `db push` : toute modif de `schema.ts` exige une migration générée (`pnpm db:generate`) dont le SQL est inspecté.
- Lancer les tests d'un fichier ciblé : `npx vitest run <chemin>`.

---

### Task 1: Extraire le module `separator` (E-2, partie 1/2)

Refactor pur sans changement de comportement : sortir `normalizeSeparator`/`escapeSeparator` de `chunker.ts` (qui dépend de `types.ts`) vers un module sans dépendance, pour que `types.ts` puisse l'importer sans cycle.

**Files:**
- Create: `src/lib/embed-test/separator.ts`
- Modify: `src/lib/embed-test/chunker.ts:17-31` (retirer les défs, re-exporter)
- Test: `tests/lib/embed-test-separator.test.ts`

**Interfaces:**
- Produces: `normalizeSeparator(separator: string): string`, `escapeSeparator(s: string): string` depuis `@/lib/embed-test/separator`. `chunker.ts` les re-exporte (les imports existants `from '@/lib/embed-test/chunker'`, ex. `claude.ts:19`, restent valides).

- [ ] **Step 1: Écrire le test (échoue)**

`tests/lib/embed-test-separator.test.ts` :
```ts
import { describe, expect, test } from 'vitest'
import { normalizeSeparator, escapeSeparator } from '@/lib/embed-test/separator'

describe('normalizeSeparator', () => {
  test('unescapes \\n and \\t to real characters', () => {
    expect(normalizeSeparator('\\n\\n')).toBe('\n\n')
    expect(normalizeSeparator('a\\tb')).toBe('a\tb')
  })
  test('leaves a real newline untouched', () => {
    expect(normalizeSeparator('\n\n')).toBe('\n\n')
  })
})

describe('escapeSeparator', () => {
  test('escapes real newline/tab to two-char forms', () => {
    expect(escapeSeparator('\n\n')).toBe('\\n\\n')
    expect(escapeSeparator('a\tb')).toBe('a\\tb')
  })
  test('idempotent on already-escaped input', () => {
    expect(escapeSeparator('\\n\\n')).toBe('\\n\\n')
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/lib/embed-test-separator.test.ts`
Expected: FAIL — module `@/lib/embed-test/separator` introuvable.

- [ ] **Step 3: Créer `separator.ts`**

`src/lib/embed-test/separator.ts` :
```ts
/**
 * Conversions séparateur entre la forme échappée que propose Claude ("\\n\\n")
 * et les caractères réels. Module sans dépendance pour être importable depuis
 * types.ts ET chunker.ts sans cycle.
 */

/** Claude proposes separators as escaped strings ("\\n\\n") — unescape them. */
export function normalizeSeparator(separator: string): string {
  return separator.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

/**
 * Display inverse of `normalizeSeparator`: real newline/tab characters → their
 * escaped two-char forms, so separators render on one line in the recommendation
 * card and the results table. Idempotent: an already-escaped "\\n" holds no REAL
 * newline character, so it passes through unchanged.
 */
export function escapeSeparator(s: string): string {
  return s.replace(/\n/g, '\\n').replace(/\t/g, '\\t')
}
```

- [ ] **Step 4: Mettre à jour `chunker.ts`**

Remplacer les définitions actuelles `normalizeSeparator` (lignes 17-20) et `escapeSeparator` (lignes 23-31) par un import + re-export en tête du fichier. Après l'import existant ligne 9 :
```ts
import type { ChunkConfig } from '@/lib/embed-test/types'
import { normalizeSeparator, escapeSeparator } from '@/lib/embed-test/separator'

// Re-exported so existing importers (claude.ts) keep importing from chunker.
export { normalizeSeparator, escapeSeparator }
```
Supprimer les deux fonctions de leur emplacement actuel (lignes 17-31). `chunker.ts` continue d'utiliser `normalizeSeparator` ligne 116 (désormais via l'import).

- [ ] **Step 5: Lancer test + suite embed-test, vérifier le vert**

Run: `npx vitest run tests/lib/embed-test-separator.test.ts tests/lib/embed-test-chunker.test.ts tests/server/embed-test-claude.test.ts`
Expected: PASS (séparateur + chunker + claude inchangés).

- [ ] **Step 6: Commit**

```bash
git add src/lib/embed-test/separator.ts src/lib/embed-test/chunker.ts tests/lib/embed-test-separator.test.ts
git commit -m "refactor(embed-test): extract separator helpers into dependency-free module"
```

---

### Task 2: `configKey` normalise le séparateur (E-2, partie 2/2)

**Files:**
- Modify: `src/lib/embed-test/types.ts:48-59`
- Test: `tests/lib/embed-test-types.test.ts`

**Interfaces:**
- Consumes: `normalizeSeparator` depuis `@/lib/embed-test/separator` (Task 1).
- Produces: `configKey(c: ChunkConfig): string` — désormais insensible à l'échappement du séparateur. Consommé par `claude.ts:192` (dédup `testedKeys`).

- [ ] **Step 1: Écrire le test (échoue)**

Ajouter à `tests/lib/embed-test-types.test.ts` :
```ts
import { configKey } from '@/lib/embed-test/types'
import type { ChunkConfig } from '@/lib/embed-test/types'

const base: ChunkConfig = {
  label: 'x',
  mode: 'general',
  separator: '\\n\\n',
  maxTokens: 200,
  overlapTokens: 0,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
}

describe('configKey — separator normalization', () => {
  test('escaped and real separators yield the SAME key', () => {
    expect(configKey({ ...base, separator: '\\n\\n' })).toBe(
      configKey({ ...base, separator: '\n\n' }),
    )
  })
  test('structurally different configs yield different keys', () => {
    expect(configKey(base)).not.toBe(configKey({ ...base, maxTokens: 300 }))
  })
})
```
(Si le fichier a déjà un `describe`/imports, réutiliser les imports existants.)

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/lib/embed-test-types.test.ts`
Expected: FAIL — les deux clés diffèrent (séparateur brut).

- [ ] **Step 3: Implémenter la normalisation**

Dans `src/lib/embed-test/types.ts`, ajouter l'import en tête (après les imports existants) :
```ts
import { normalizeSeparator } from '@/lib/embed-test/separator'
```
Modifier `configKey` (ligne 51) pour normaliser le séparateur :
```ts
export function configKey(c: ChunkConfig): string {
  return JSON.stringify([
    c.mode,
    normalizeSeparator(c.separator),
    c.maxTokens,
    c.overlapTokens,
    c.parentMaxTokens ?? null,
    c.childMaxTokens ?? null,
    c.preprocessing.removeExtraSpaces,
    c.preprocessing.removeUrlsEmails,
  ])
}
```

- [ ] **Step 4: Lancer test + claude (dédup), vérifier le vert**

Run: `npx vitest run tests/lib/embed-test-types.test.ts tests/server/embed-test-claude.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/embed-test/types.ts tests/lib/embed-test-types.test.ts
git commit -m "fix(embed-test): normalize separator in configKey so dedup ignores escaping (E-2)"
```

---

### Task 3: Bornes des JSON tool schemas (E-5, bug fatal + guidage)

`OCR_TOOL_SCHEMA.coverage` sans bornes → Claude peut renvoyer `1.05` → `ocrVerdictSchema.parse()` rejette → étape OCR en erreur, run perdu. On borne le schéma d'outil pour empêcher le modèle de produire la valeur, + bornes de guidage sur `CONFIG_PROPERTIES`.

**Files:**
- Modify: `src/server/embed-test/claude.ts:44-56` (OCR) et `:91-109` (CONFIG_PROPERTIES)
- Test: `tests/server/embed-test-claude.test.ts`

**Interfaces:**
- Produces: constantes `OCR_TOOL_SCHEMA` et `CONFIG_PROPERTIES` exportées pour test (voir Step 3). Aucune signature publique modifiée.

- [ ] **Step 1: Écrire le test (échoue)**

Ajouter à `tests/server/embed-test-claude.test.ts` :
```ts
import { OCR_TOOL_SCHEMA, CONFIG_PROPERTIES } from '@/server/embed-test/claude'

describe('tool schema bounds (E-5)', () => {
  test('OCR coverage is bounded to [0,1]', () => {
    const cov = OCR_TOOL_SCHEMA.properties!.coverage as Record<string, unknown>
    expect(cov.minimum).toBe(0)
    expect(cov.maximum).toBe(1)
  })
  test('maxTokens is bounded 100..4000', () => {
    const mt = CONFIG_PROPERTIES.maxTokens as Record<string, unknown>
    expect(mt.minimum).toBe(100)
    expect(mt.maximum).toBe(4000)
  })
  test('overlapTokens has a non-negative minimum', () => {
    const ot = CONFIG_PROPERTIES.overlapTokens as Record<string, unknown>
    expect(ot.minimum).toBe(0)
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/server/embed-test-claude.test.ts`
Expected: FAIL — `OCR_TOOL_SCHEMA`/`CONFIG_PROPERTIES` non exportés et/ou bornes absentes.

- [ ] **Step 3: Implémenter les bornes + exports**

Dans `src/server/embed-test/claude.ts` :

1. Exporter les deux constantes : remplacer `const OCR_TOOL_SCHEMA` par `export const OCR_TOOL_SCHEMA` (ligne 44) et `const CONFIG_PROPERTIES` par `export const CONFIG_PROPERTIES` (ligne 91).

2. Borner `coverage` dans `OCR_TOOL_SCHEMA` (ligne 49) :
```ts
    coverage: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Part (0..1) du contenu lu visuellement présent dans le texte natif',
    },
```

3. Borner les champs numériques de `CONFIG_PROPERTIES` (lignes 95-98) :
```ts
  maxTokens: { type: 'integer', minimum: 100, maximum: 4000, description: 'Longueur max de chunk en tokens (100-4000)' },
  overlapTokens: { type: 'integer', minimum: 0, description: 'Chevauchement en tokens, < maxTokens' },
  parentMaxTokens: { type: 'integer', minimum: 100, maximum: 8000 },
  childMaxTokens: { type: 'integer', minimum: 50, maximum: 4000 },
```

- [ ] **Step 4: Lancer test + suite claude, vérifier le vert**

Run: `npx vitest run tests/server/embed-test-claude.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/embed-test/claude.ts tests/server/embed-test-claude.test.ts
git commit -m "fix(embed-test): bound OCR coverage + config token fields in tool schemas (E-5)"
```

---

### Task 4: Garde `childMaxTokens < parentMaxTokens` (E-5)

**Files:**
- Modify: `src/lib/embed-test/types.ts:34-39` (après le `.refine` parent-child existant)
- Test: `tests/lib/embed-test-types.test.ts`

**Interfaces:**
- Produces: `chunkConfigSchema` rejette désormais `childMaxTokens >= parentMaxTokens` en mode parent-child.

- [ ] **Step 1: Écrire le test (échoue)**

Ajouter à `tests/lib/embed-test-types.test.ts` :
```ts
import { chunkConfigSchema } from '@/lib/embed-test/types'

const pc = {
  label: 'pc',
  mode: 'parent-child' as const,
  separator: '\\n\\n',
  maxTokens: 1000,
  overlapTokens: 0,
  parentMaxTokens: 1000,
  childMaxTokens: 300,
  preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
}

describe('chunkConfigSchema — parent-child sizing', () => {
  test('accepts child < parent', () => {
    expect(chunkConfigSchema.safeParse(pc).success).toBe(true)
  })
  test('rejects child >= parent', () => {
    expect(chunkConfigSchema.safeParse({ ...pc, childMaxTokens: 1000 }).success).toBe(false)
    expect(chunkConfigSchema.safeParse({ ...pc, childMaxTokens: 1200 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/lib/embed-test-types.test.ts`
Expected: FAIL — `child >= parent` actuellement accepté.

- [ ] **Step 3: Implémenter le `.refine`**

Dans `src/lib/embed-test/types.ts`, après le `.refine` parent-child existant (ligne 38, celui qui exige `parentMaxTokens`/`childMaxTokens` définis), chaîner :
```ts
  .refine(
    (c) =>
      c.mode === 'general' ||
      c.parentMaxTokens === undefined ||
      c.childMaxTokens === undefined ||
      c.childMaxTokens < c.parentMaxTokens,
    { message: 'childMaxTokens must be < parentMaxTokens' },
  )
```

- [ ] **Step 4: Lancer test, vérifier le vert**

Run: `npx vitest run tests/lib/embed-test-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/embed-test/types.ts tests/lib/embed-test-types.test.ts
git commit -m "fix(embed-test): reject childMaxTokens >= parentMaxTokens (E-5)"
```

---

### Task 5: Helper magic bytes partagé

**Files:**
- Create: `src/lib/upload/magic-bytes.ts`
- Test: `tests/lib/magic-bytes.test.ts`

**Interfaces:**
- Produces: `isPdf(bytes: Uint8Array): boolean` (`%PDF` = `25 50 44 46`), `isZip(bytes: Uint8Array): boolean` (`50 4b 03 04`, conteneur docx). Consommé par les routes upload (Task 6).

- [ ] **Step 1: Écrire le test (échoue)**

`tests/lib/magic-bytes.test.ts` :
```ts
import { describe, expect, test } from 'vitest'
import { isPdf, isZip } from '@/lib/upload/magic-bytes'

describe('isPdf', () => {
  test('true on %PDF signature', () => {
    expect(isPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true)
  })
  test('false on non-PDF bytes', () => {
    expect(isPdf(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false)
  })
  test('false on buffer too short', () => {
    expect(isPdf(new Uint8Array([0x25, 0x50]))).toBe(false)
  })
})

describe('isZip', () => {
  test('true on PK\\x03\\x04 signature', () => {
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
  })
  test('false on PDF bytes', () => {
    expect(isZip(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/lib/magic-bytes.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Créer le helper**

`src/lib/upload/magic-bytes.ts` :
```ts
/**
 * File-type sniffing by magic bytes — the MIME `file.type` is client-controlled,
 * so every upload route also checks the real signature. Single source of truth
 * shared by all upload routes (embed-test, faq-builder, formation documents).
 */

/** PDF: starts with "%PDF" (0x25 0x50 0x44 0x46). */
export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  )
}

/** ZIP container (docx, xlsx…): starts with "PK\x03\x04". */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
}
```

- [ ] **Step 4: Lancer test, vérifier le vert**

Run: `npx vitest run tests/lib/magic-bytes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload/magic-bytes.ts tests/lib/magic-bytes.test.ts
git commit -m "feat(upload): shared magic-bytes sniffing helper (isPdf/isZip)"
```

---

### Task 6: Appliquer les magic bytes aux routes PDF + refactor faq-builder

**Files:**
- Modify: `src/app/api/admin/embed-test/route.ts:43-44` (ajout check `%PDF`)
- Modify: `src/app/api/admin/formations/[id]/documents/route.ts:54-55` (ajout check `%PDF`)
- Modify: `src/app/api/admin/faq-builder/route.ts:24-36,60-62` (`sniffKind` consomme le helper)
- Test: `tests/server/embed-test-route.test.ts`, `tests/server/upload-route.test.ts`

**Interfaces:**
- Consumes: `isPdf`, `isZip` depuis `@/lib/upload/magic-bytes` (Task 5).

- [ ] **Step 1: Écrire les tests (échouent)**

Dans `tests/server/embed-test-route.test.ts`, ajouter un cas (le helper `makeRequest` y construit déjà un `File` ; passer un PDF MIME mais contenu non-PDF) :
```ts
test('PDF MIME but non-PDF content → 415', async () => {
  const file = new File(['PK\x03\x04 not a pdf'], 'doc.pdf', { type: 'application/pdf' })
  const res = await POST(makeRequest({ file }))
  expect(res.status).toBe(415)
})
```
Dans `tests/server/upload-route.test.ts` (route formations documents), ajouter le cas équivalent en suivant le pattern de construction de requête déjà présent dans ce fichier (réutiliser son helper de `FormData`/`File` ; fournir un `File(['not pdf'], 'd.pdf', { type:'application/pdf' })` et attendre 415).

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/server/embed-test-route.test.ts tests/server/upload-route.test.ts`
Expected: FAIL — actuellement 415 non renvoyé (MIME seul accepté).

- [ ] **Step 3: Brancher le helper dans embed-test route**

`src/app/api/admin/embed-test/route.ts` — ajouter l'import :
```ts
import { isPdf } from '@/lib/upload/magic-bytes'
```
Le buffer est lu ligne 77 (`await file.arrayBuffer()`) APRÈS le bloc de validation. Déplacer la lecture du buffer avant la validation magic bytes : remplacer la vérif MIME (ligne 43) de sorte qu'après avoir vérifié `file.type` et `file.size`, on lise le buffer et on vérifie la signature. Concrètement, après la ligne 44 (`if (file.size > MAX_SIZE) ...`), insérer la lecture+vérif et réutiliser ce buffer plus bas :
```ts
    // (inchangé) file.type et file.size déjà validés ci-dessus
```
Puis, à l'endroit où `buffer` est construit (ligne 77), le remonter dans le `try` de parsing et ajouter la vérif :
```ts
  const buffer = new Uint8Array(await file.arrayBuffer())
  if (!isPdf(buffer)) return json({ error: 'invalid_type' }, 415)
```
Note : `buffer` doit rester en scope pour `runEmbedTest(buffer, ...)` (ligne 88). Le déclarer avant le `ReadableStream` (comme aujourd'hui ligne 77) et faire la vérif `isPdf` juste après cette ligne, avant la création du stream.

- [ ] **Step 4: Brancher le helper dans formations documents route**

`src/app/api/admin/formations/[id]/documents/route.ts` — après la vérif MIME `file.type !== 'application/pdf'` (lignes 54-55), lire le buffer (s'il ne l'est pas déjà plus bas — sinon remonter la lecture) et ajouter :
```ts
import { isPdf } from '@/lib/upload/magic-bytes'
// ... après lecture du buffer :
if (!isPdf(buffer)) {
  return Response.json({ error: 'invalid_type' }, { status: 415 })
}
```
Si le fichier lit déjà le buffer plus bas, remonter cette lecture avant la création de toute ressource (upload S3/écriture) pour rejeter tôt.

- [ ] **Step 5: Refactor `sniffKind` (faq-builder)**

`src/app/api/admin/faq-builder/route.ts` — remplacer le corps inline de `sniffKind` (lignes 27-32) par le helper :
```ts
import { isPdf, isZip } from '@/lib/upload/magic-bytes'

/** Extension AND magic bytes must agree — both checked (audit convention). */
function sniffKind(name: string, bytes: Uint8Array): 'pdf' | 'docx' | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf') && isPdf(bytes)) return 'pdf'
  if (lower.endsWith('.docx') && isZip(bytes)) return 'docx'
  return null
}
```

- [ ] **Step 6: Lancer les tests de routes, vérifier le vert**

Run: `npx vitest run tests/server/embed-test-route.test.ts tests/server/upload-route.test.ts tests/server/faq-builder-route.test.ts`
Expected: PASS (dont le test magic bytes faq-builder existant, inchangé).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/embed-test/route.ts "src/app/api/admin/formations/[id]/documents/route.ts" src/app/api/admin/faq-builder/route.ts tests/server/embed-test-route.test.ts tests/server/upload-route.test.ts
git commit -m "fix(upload): verify %PDF magic bytes on all PDF upload routes (F-3)"
```

---

### Task 7: Helper `hashBuffer` (E-3, partie 1/3)

**Files:**
- Create: `src/server/embed-test/file-hash.ts`
- Test: `tests/server/embed-test-file-hash.test.ts`

**Interfaces:**
- Produces: `hashBuffer(bytes: Uint8Array): string` — sha256 hex. Server-only (`node:crypto`). Consommé par le pipeline (Task 9) et les tests.

- [ ] **Step 1: Écrire le test (échoue)**

`tests/server/embed-test-file-hash.test.ts` :
```ts
import { describe, expect, test } from 'vitest'
import { hashBuffer } from '@/server/embed-test/file-hash'

describe('hashBuffer', () => {
  test('stable hex digest for identical bytes', () => {
    const a = hashBuffer(new Uint8Array([1, 2, 3]))
    const b = hashBuffer(new Uint8Array([1, 2, 3]))
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
  test('different bytes → different digest', () => {
    expect(hashBuffer(new Uint8Array([1]))).not.toBe(hashBuffer(new Uint8Array([2])))
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/server/embed-test-file-hash.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Créer le helper**

`src/server/embed-test/file-hash.ts` :
```ts
import { createHash } from 'node:crypto'

/** sha256 hex digest — used to detect a re-uploaded file changing between rounds. */
export function hashBuffer(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
```

- [ ] **Step 4: Lancer test, vérifier le vert**

Run: `npx vitest run tests/server/embed-test-file-hash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/embed-test/file-hash.ts tests/server/embed-test-file-hash.test.ts
git commit -m "feat(embed-test): sha256 hashBuffer helper for refine file-identity check (E-3)"
```

---

### Task 8: `fileHash` dans le report et le refine payload (E-3, partie 2/3)

**Files:**
- Modify: `src/lib/embed-test/types.ts:84-93` (`refinePayloadSchema`), `:112-118` (`EmbedTestReport`)
- Test: `tests/lib/embed-test-types.test.ts`

**Interfaces:**
- Produces: `EmbedTestReport.fileHash: string` ; `refinePayloadSchema` accepte `fileHash?: string` (`RefinePayload.fileHash?: string`).

- [ ] **Step 1: Écrire le test (échoue)**

Ajouter à `tests/lib/embed-test-types.test.ts` :
```ts
import { refinePayloadSchema } from '@/lib/embed-test/types'

describe('refinePayloadSchema — fileHash', () => {
  const valid = {
    ocr: { verdict: 'text_ok', reason: 'ok', coverage: 0.9 },
    tested: [
      {
        config: {
          label: 'a', mode: 'general', separator: '\\n\\n', maxTokens: 200,
          overlapTokens: 0,
          preprocessing: { removeExtraSpaces: true, removeUrlsEmails: false },
        },
        score: 5, issues: [], round: 1,
      },
    ],
  }
  test('accepts payload with fileHash', () => {
    expect(refinePayloadSchema.safeParse({ ...valid, fileHash: 'abc' }).success).toBe(true)
  })
  test('accepts payload without fileHash (optional)', () => {
    expect(refinePayloadSchema.safeParse(valid).success).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier l'échec/le passage**

Run: `npx vitest run tests/lib/embed-test-types.test.ts`
Expected: le 1er cas peut déjà passer (zod ignore les clés inconnues par défaut) mais l'objectif est de TYPER `fileHash`. Si les deux passent déjà, garder le test comme garde de régression et continuer Step 3 pour le typage.

- [ ] **Step 3: Ajouter `fileHash` aux types**

Dans `src/lib/embed-test/types.ts` :

`refinePayloadSchema` (ligne 84) — ajouter le champ :
```ts
export const refinePayloadSchema = z.object({
  ocr: z.object({
    verdict: z.enum(['text_ok', 'ocr_needed']),
    reason: z.string(),
    coverage: z.number().min(0).max(1),
  }),
  tested: z.array(testedConfigSchema).min(1).max(30),
  /** sha256 du PDF du tour 1 ; si absent ou ≠ fichier courant, l'OCR est recalculé. */
  fileHash: z.string().optional(),
  /** Optional admin-supplied config: pipeline judges ONLY this, skips propose. */
  manual: chunkConfigSchema.optional(),
})
```

`EmbedTestReport` (ligne 112) — ajouter `fileHash` :
```ts
export type EmbedTestReport = {
  ocr: OcrVerdict
  /** sha256 du PDF testé — renvoyé au client pour vérifier l'identité au refine. */
  fileHash: string
  ranking: number[]
  recommendation: { configIndex: number; difySettings: string; rationale: string }
  usage: { inputTokens: number; outputTokens: number }
}
```

- [ ] **Step 4: Lancer test + tsc, vérifier le vert**

Run: `npx vitest run tests/lib/embed-test-types.test.ts && pnpm typecheck`
Expected: PASS. tsc échouera tant que le pipeline (Task 9) ne fournit pas `fileHash` au report — c'est attendu ; si `pnpm typecheck` casse UNIQUEMENT sur `fileHash` manquant dans `pipeline.ts`, c'est le signal d'enchaîner Task 9. (Ne pas committer un tsc rouge : faire ce commit AVEC la modif pipeline si nécessaire, sinon committer ici si tsc est vert.)

> Note d'exécution : Tasks 8 et 9 partagent la contrainte tsc (le type `fileHash` requis dans `EmbedTestReport` n'est satisfait qu'en Task 9). Si l'exécutant veut des commits tsc-verts, fusionner les commits 8 et 9. Sinon, committer Task 8 puis Task 9 et accepter un tsc transitoirement rouge entre les deux (jamais poussé tel quel).

- [ ] **Step 5: Commit**

```bash
git add src/lib/embed-test/types.ts tests/lib/embed-test-types.test.ts
git commit -m "feat(embed-test): add fileHash to report and refine payload (E-3)"
```

---

### Task 9: Pipeline recalcule l'OCR si le fichier change + client renvoie le hash (E-3, partie 3/3)

**Files:**
- Modify: `src/server/embed-test/pipeline.ts:54-124` (calcul hash + branche refine), report final
- Modify: `src/lib/embed-test/useEmbedTest.ts:113-115` (`buildRefinePayload` ajoute `fileHash`)
- Test: `tests/server/embed-test-pipeline.test.ts`

**Interfaces:**
- Consumes: `hashBuffer` (Task 7), `EmbedTestReport.fileHash` + `RefinePayload.fileHash` (Task 8).
- Produces: comportement refine — réutilise `refine.ocr` **ssi** `refine.fileHash === hashBuffer(buffer)` ; sinon recalcule l'OCR (appel vision) avec step `'Fichier modifié — recalcul du verdict OCR'`. Le report porte `fileHash`.

- [ ] **Step 1: Mettre à jour les tests pipeline (échouent)**

Dans `tests/server/embed-test-pipeline.test.ts` :

1. Importer le helper en tête : `import { hashBuffer } from '@/server/embed-test/file-hash'`. Le buffer de test est `new Uint8Array([0])` (helpers `collect`/`collectRefine` lignes 63/69) → `const BUF_HASH = hashBuffer(new Uint8Array([0]))`.

2. **Modifier** le test existant « refine run: ocrCompare and buildPdfSample are never called, verdict reused » : ajouter `fileHash: BUF_HASH` au `refine` pour qu'il corresponde au buffer courant (sinon l'OCR sera recalculé). L'assertion `ocrCompare).not.toHaveBeenCalled()` reste valide.

3. Ajouter deux tests :
```ts
test('refine with mismatched fileHash → OCR recomputed (vision called)', async () => {
  const refine: RefinePayload = {
    ocr: { verdict: 'ocr_needed', reason: 'tour 1', coverage: 0.1 },
    tested: [{ config: config('A'), score: 2, issues: [], round: 1 }],
    fileHash: 'deadbeef-not-the-current-file',
  }
  const events = await collectRefine(refine)
  expect(ocrCompare).toHaveBeenCalledTimes(1)
  const ocrStep = events.find((e) => e.type === 'step' && e.id === 'ocr')
  expect(ocrStep?.type === 'step' && ocrStep.label).toContain('recalcul')
  const report = events.find((e) => e.type === 'report')
  if (report?.type === 'report') expect(report.report.ocr.verdict).toBe('text_ok') // from ocrCompare mock
})

test('refine without fileHash → OCR recomputed', async () => {
  const refine: RefinePayload = {
    ocr: { verdict: 'ocr_needed', reason: 'tour 1', coverage: 0.1 },
    tested: [{ config: config('A'), score: 2, issues: [], round: 1 }],
  }
  await collectRefine(refine)
  expect(ocrCompare).toHaveBeenCalledTimes(1)
})

test('report carries the file hash', async () => {
  const events = await collect()
  const report = events.find((e) => e.type === 'report')
  if (report?.type === 'report') expect(report.report.fileHash).toBe(hashBuffer(new Uint8Array([0])))
})
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/server/embed-test-pipeline.test.ts`
Expected: FAIL — `report.fileHash` indéfini ; OCR non recalculé sur mismatch.

- [ ] **Step 3: Implémenter dans `pipeline.ts`**

Import en tête : `import { hashBuffer } from '@/server/embed-test/file-hash'`.

Calculer le hash tôt dans `runEmbedTest` (après la signature, avant l'extraction) :
```ts
  const fileHash = hashBuffer(buffer)
```

Remplacer la branche OCR (lignes 91-124) pour décider réutilisation vs recalcul :
```ts
  // 2. OCR verdict. On a refine run we reuse the previous verdict ONLY if the
  // re-uploaded file is identical (same hash); otherwise we recompute it so a
  // wrong file can't silently inherit a stale verdict (audit E-3).
  let ocr: OcrVerdict
  const reuseOcr = refine != null && refine.fileHash === fileHash
  if (reuseOcr) {
    emit({ type: 'step', id: 'ocr', label: 'Verdict OCR réutilisé (tour précédent)' })
    ocr = refine!.ocr
  } else {
    emit({
      type: 'step',
      id: 'ocr',
      label: refine
        ? 'Fichier modifié — recalcul du verdict OCR…'
        : 'Comparaison OCR vs extraction texte…',
    })
    const indices = samplePageIndices(totalPages, MAX_VISION_PAGES)
    try {
      const samplePdf = await buildPdfSample(buffer, indices)
      const nativeSample = indices.map((i) => pages[i] ?? '').join('\n\n--- PAGE ---\n\n')
      const res = await ocrCompare(client, model, toBase64(samplePdf), nativeSample)
      add(res.usage)
      ocr = res.data
    } catch (err) {
      console.error('[embed-test] OCR compare a échoué:', err)
      if (err instanceof PdfUnreadableError) {
        emit({ type: 'error', code: 'pdf_unreadable', message: 'PDF illisible — protégé, corrompu ou non valide.' })
        return
      }
      emit({ type: 'error', code: 'ocr_compare_failed', message: "L'analyse OCR via l'API Claude a échoué. Réessayez." })
      return
    }
  }
```

Ajouter `fileHash` à l'objet report final (chercher l'endroit où l'événement `{ type: 'report', report: {...} }` est construit, vers la fin de `runEmbedTest`, et inclure `fileHash,` dans le littéral `report`).

- [ ] **Step 4: Mettre à jour le client `buildRefinePayload`**

`src/lib/embed-test/useEmbedTest.ts` (ligne 113-115) :
```ts
export function buildRefinePayload(state: EmbedTestState): RefinePayload | null {
  if (!state.report) return null
  return {
    ocr: state.report.ocr,
    tested: state.history.slice(-30),
    fileHash: state.report.fileHash,
  }
}
```
(Adapter à la forme exacte du retour existant — ajouter `fileHash: state.report.fileHash` à l'objet retourné, en conservant les guards existants.)

- [ ] **Step 5: Lancer la suite pipeline + tsc, vérifier le vert**

Run: `npx vitest run tests/server/embed-test-pipeline.test.ts && pnpm typecheck`
Expected: PASS, tsc vert.

- [ ] **Step 6: Commit**

```bash
git add src/server/embed-test/pipeline.ts src/lib/embed-test/useEmbedTest.ts tests/server/embed-test-pipeline.test.ts
git commit -m "fix(embed-test): recompute OCR when refine file hash differs (E-3)"
```

---

### Task 10: Enum DB `feedback` + migration (D-4)

**Files:**
- Modify: `src/server/db/schema.ts:6-8` (déclaration enum), `:109` (colonne)
- Create: migration `drizzle/00XX_*.sql` (générée)
- Test: aucun test unitaire (changement structurel) — vérification par inspection SQL + tsc + suite verte

**Interfaces:**
- Produces: `chat_queries.feedback` typée `chat_feedback` (`'like' | 'dislike' | null`). `brain.ts:32` (`.set({ feedback })`) et `admin-faq-gaps.ts:36` (`eq(feedback,'dislike')`) restent compatibles.

- [ ] **Step 1: Déclarer l'enum et typer la colonne**

Dans `src/server/db/schema.ts`, après les enums existants (ligne 8) :
```ts
export const chatFeedbackEnum = pgEnum('chat_feedback', ['like', 'dislike'])
```
Remplacer la colonne (ligne 109) :
```ts
  feedback: chatFeedbackEnum('feedback'), // 'like' | 'dislike' | null
```
L'index `chat_queries_feedback_idx` (ligne 114) est conservé tel quel.

- [ ] **Step 2: Vérifier le typage**

Run: `pnpm typecheck`
Expected: PASS — `brain.ts` passe `input.feedback` (`z.enum(['like','dislike'])`), compatible avec le type enum Drizzle.

- [ ] **Step 3: Générer la migration**

Run: `pnpm db:generate`
Expected: nouveau fichier `drizzle/00XX_*.sql` créé.

- [ ] **Step 4: Inspecter et corriger le SQL de migration**

Ouvrir le `.sql` généré. Il doit (a) `CREATE TYPE "public"."chat_feedback" AS ENUM('like', 'dislike');` puis (b) altérer la colonne. **Vérifier impérativement** que l'`ALTER COLUMN ... SET DATA TYPE chat_feedback` comporte une clause `USING "feedback"::"chat_feedback"` ; Drizzle l'omet parfois → le `ALTER` échouerait en prod sur une colonne `text` non vide. Si absente, l'ajouter à la main :
```sql
ALTER TABLE "chat_queries" ALTER COLUMN "feedback" SET DATA TYPE "chat_feedback" USING "feedback"::"chat_feedback";
```
Les données existantes ne contiennent que `'like'`/`'dislike'`/`null` (seul writer : `brain.ts`), le cast est sûr.

- [ ] **Step 5: Lancer la suite complète + lint + tsc**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: tous verts (les tests ne touchent pas une vraie DB ; vérification structurelle uniquement).

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(db): constrain chat_queries.feedback to enum at DB level (D-4)"
```

---

### Task 11: Vérification finale + revue

- [ ] **Step 1: Suite + lint + tsc verts**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: lint 0 warning, tsc 0 erreur, tests ≥ 528 + nouveaux, tous verts.

- [ ] **Step 2: Revue de branche**

Lancer `superpowers:requesting-code-review` (revue Fable 5 sur le diff de branche `feat/embed-lab-polish` vs `main`). Traiter les retours via `superpowers:receiving-code-review`.

- [ ] **Step 3: Finalisation**

Via `superpowers:finishing-a-development-branch` : pousser la branche, ouvrir la PR ⑦, mettre à jour la mémoire projet formaps.

---

## Self-Review (auteur du plan)

**Couverture spec :**
- E-2 → Tasks 1+2 ✅
- E-5 (coverage fatal + bornes config + child<parent) → Tasks 3+4 ✅
- E-3 (hash refine, recompute on mismatch) → Tasks 7+8+9 ✅
- D-4 (enum feedback DB) → Task 10 ✅
- Magic bytes (helper partagé, routes PDF) → Tasks 5+6 ✅
- D-1, stop_reason/max_tokens (hors scope, déjà faits), timestamptz (différé) → non planifiés, conforme spec ✅

**Placeholders :** aucun TODO/TBD ; code complet à chaque step. Les seuls points « adapter à la forme exacte » (Task 6 lecture buffer, Task 9 client) sont accompagnés du code cible et de la contrainte de scope — l'exécutant lit le fichier réel.

**Cohérence des types :** `hashBuffer` (Task 7) ↔ usage pipeline/tests (Task 9) ; `EmbedTestReport.fileHash` (Task 8) ↔ report pipeline (Task 9) ↔ `buildRefinePayload` (Task 9) ; `isPdf`/`isZip` (Task 5) ↔ routes (Task 6) ; `OCR_TOOL_SCHEMA`/`CONFIG_PROPERTIES` exports (Task 3) ↔ tests. Cohérents.

**Risque identifié :** contrainte tsc partagée Tasks 8/9 (documentée dans Task 8 Step 4) ; clause `USING` migration D-4 (documentée Task 10 Step 4).
