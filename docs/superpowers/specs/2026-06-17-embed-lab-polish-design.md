# Spec — PR ⑦ embed-lab polish + hardening

Date : 2026-06-17
Branche : `feat/embed-lab-polish`
Origine : dernier PR de la roadmap d'audit 2026-06-09 (`docs/reviews/2026-06-09-full-audit-synthesis.md`, item 7).

## Contexte

Audit complet 2026-06-09 → roadmap 7 PRs, 6 mergées. Reste l'item 7 « embed-lab +
DB polish ». Après vérification de l'état réel du code, le périmètre se réduit aux
points encore ouverts ci-dessous. Items déjà traités par des PRs antérieures et
**hors scope** :

- **D-1** email lowercase — fait (`normalizeEmail` + index unique `lower(email)`
  migration `0008`).
- **stop_reason / max_tokens** — fait (`src/server/claude-core.ts` : throw
  `ClaudeOutputTruncatedError` sur `stop_reason === 'max_tokens'`, `max_tokens: 16000`).
- **timestamptz** — différé (décision 2026-06-17 : YAGNI, serveur calcule en UTC,
  aucun bug concret observé).

## Items à livrer

### E-2 — `configKey` normalisé (dédup robuste)

**Problème.** `configKey` (`src/lib/embed-test/types.ts:48`) sérialise `c.separator`
brut. `"\n\n"` (réel) et `"\\n\\n"` (échappé) produisent deux clés différentes, donc
la dédup vs `testedKeys` dans `proposeAttempt` (`claude.ts:192`) est contournée et
Claude re-propose des configs structurellement identiques.

**Contrainte.** `normalizeSeparator` vit dans `chunker.ts`, qui importe `ChunkConfig`
depuis `types.ts`. Faire importer `types.ts → chunker.ts` créerait un cycle d'imports.

**Solution.** Extraire `normalizeSeparator` et `escapeSeparator` dans un nouveau module
sans dépendance `src/lib/embed-test/separator.ts`. `chunker.ts`, `claude.ts` et
`types.ts` l'importent. `configKey` normalise le séparateur avant sérialisation :

```ts
import { normalizeSeparator } from './separator'
// ...
c.separator -> normalizeSeparator(c.separator)
```

Un seul point de vérité, conforme à la règle anti-divergence des normaliseurs.

**Tests.** `separator.test.ts` (normalize/escape inchangés, idempotence) +
`configKey` : `"\n\n"` et `"\\n\\n"` produisent la même clé ; deux modes différents
produisent des clés différentes.

### E-5 — Bornes des schémas (dont un bug fatal)

1. **Bug fatal — `OCR_TOOL_SCHEMA.coverage`** (`claude.ts:49`) : ajouter
   `minimum: 0, maximum: 1`. Aujourd'hui Claude peut renvoyer `coverage: 1.05` →
   `ocrVerdictSchema.parse()` (`.min(0).max(1)`, `claude.ts:86`) **throw** → tout le
   run échoue (erreur fatale, pas de fallback).
2. **`CONFIG_PROPERTIES`** numériques (`claude.ts:91`) : ajouter `minimum/maximum`
   cohérents avec `chunkConfigSchema` — `maxTokens` 100–4000, `overlapTokens` ≥ 0,
   `parentMaxTokens`/`childMaxTokens` bornés. Non-fatal aujourd'hui (`safeParse` par
   config les jette, `claude.ts:190`) mais réduit le gaspillage de propositions.
3. **Garde `childMaxTokens < parentMaxTokens`** : ajouter un `.refine` à
   `chunkConfigSchema` (`types.ts`). Aujourd'hui `enfant ≥ parent` est accepté.

**Tests.** `chunkConfigSchema` rejette `childMaxTokens >= parentMaxTokens` en mode
parent-child ; accepte le cas valide. (Les bornes du JSON tool schema sont des
constantes statiques validées par `tsc`/revue, pas de test runtime nécessaire ;
on garde un test attestant que `coverage` hors [0,1] serait rejeté par
`ocrVerdictSchema` pour documenter l'intention.)

### E-3 — Hash du fichier au refine

**Problème.** `runEmbedTest` (`pipeline.ts:91-95`) réutilise `refine.ocr` (verdict OCR
du tour précédent) sans aucun contrôle que le PDF re-uploadé est le même. Un mauvais
fichier au refine → reco OCR fausse silencieuse.

**Flux retenu** (décision 2026-06-17 : recalcul OCR sur mismatch).

1. `runEmbedTest` calcule `fileHash = sha256(buffer)` (`node:crypto`, runtime déjà
   `nodejs`).
2. `EmbedTestReport` (`types.ts:112`) gagne `fileHash: string`, émis dans l'événement
   `report`.
3. Client `buildRefinePayload` (`useEmbedTest.ts:113`) ajoute
   `fileHash: state.report.fileHash`. `refinePayloadSchema` (`types.ts:84`) gagne
   `fileHash: z.string().optional()` (optionnel pour tolérer un parse d'ancien
   payload).
4. Pipeline au refine : réutilise `refine.ocr` **seulement si**
   `refine.fileHash === fileHash` courant. Sinon (mismatch **ou** `fileHash` absent)
   → recalcule l'OCR via l'appel vision, avec un step
   `'Fichier modifié — recalcul du verdict OCR'`.

**Tests.** `pipeline.test.ts`, fake client Anthropic existant, 3 cas :
- refine + `fileHash` égal → pas d'appel `ocrCompare`, `refine.ocr` réutilisé ;
- refine + `fileHash` différent → `ocrCompare` appelé (recompute), step émis ;
- refine sans `fileHash` → `ocrCompare` appelé (recompute).

### D-4 — Enum feedback au niveau DB

**Problème.** `chat_queries.feedback` (`schema.ts:109`) = `text` libre. L'entrée est
validée `z.enum(['like','dislike'])` côté `brain.ts:28`, mais aucune défense en
profondeur côté DB.

**Solution.** `pgEnum('chat_feedback', ['like','dislike'])`, colonne nullable
(`null` = pas de feedback), + migration drizzle générée (`db:generate`). L'index
`chat_queries_feedback_idx` est conservé. Les usages lecture (`admin-faq-gaps.ts`)
comparent déjà à `'dislike'` → inchangés.

**Migration.** Vérifier que la migration générée gère la colonne existante (cast
`text → chat_feedback`). Données existantes : uniquement `'like'`/`'dislike'`/`null`
(garanti par le seul writer `brain.ts`), le cast est sûr.

### Magic bytes — helper partagé, routes PDF

**Problème.** Plusieurs routes d'upload ne valident que `file.type` (MIME, contrôlable
client). `faq-builder` a déjà un check magic bytes inline (`sniffKind`).

**Solution.** Nouveau `src/lib/upload/magic-bytes.ts` : `isPdf(bytes)` (`%PDF`),
`isZip(bytes)` (`PK\x03\x04`, pour docx). Appliqué à :
- `src/app/api/admin/embed-test/route.ts` : ajoute le check `%PDF` après lecture du
  buffer → `invalid_type` 415 si échec (aujourd'hui MIME seul).
- `src/app/api/admin/formations/[id]/documents/route.ts` : idem (MIME seul aujourd'hui).
- `src/app/api/admin/faq-builder/route.ts` : `sniffKind` refactorisé pour consommer
  `isPdf`/`isZip` (supprime la duplication).

Routes cover (images, `formations/[id]/cover`, `news/[id]/cover`) **hors scope** :
l'audit visait les PDF ; sniff image = extension future si souhaitée.

**Tests.** `magic-bytes.test.ts` : `isPdf`/`isZip` sur signatures valides, invalides,
buffers trop courts.

## Méthode

- TDD strict (test rouge → impl → vert), un commit par item.
- Ordre suggéré : E-5 coverage (bug fatal) → E-2 → E-5 bornes/refine → magic bytes →
  E-3 → D-4 (migration en dernier).
- Vérification pré-fini : `pnpm lint && pnpm typecheck && pnpm test` verts + revue de
  branche Fable 5.
- Baseline avant travaux : 528 tests verts (main `3ece616`).

## Critères de succès

- Dédup configKey insensible à l'échappement du séparateur (E-2).
- Un `coverage` hors [0,1] proposé par Claude ne fait plus échouer le run (E-5).
- `childMaxTokens >= parentMaxTokens` rejeté (E-5).
- Refine sur un fichier différent recalcule l'OCR au lieu de réutiliser un verdict
  obsolète (E-3).
- `chat_queries.feedback` contraint au niveau DB (D-4).
- Toute route d'upload PDF valide les magic bytes via un helper partagé unique.
- Suite verte, lint+tsc verts, aucun changement de comportement sur les chemins
  nominaux existants.
