# Labo d'embed v2 — Raffinement itératif + diagnostic de structure

**Date** : 2026-06-07
**Statut** : spec validée (brainstorming), en attente de plan d'implémentation

## Objectif

Constat terrain : les scores plafonnent (≤ 3,5/10) sur les documents réels. Deux
features pour transformer le labo en outil d'itération :

1. **Raffiner** : après un run, Claude reçoit l'historique des configs déjà
   testées (scores + problèmes relevés) et propose une vague corrigée — bouton
   « Raffiner (tour N) ». Le verdict OCR du tour 1 est réutilisé (pas de nouvel
   appel vision).
2. **Diagnostic de structure** : analyse déterministe du texte extrait
   (sauts de paragraphe, longueur des paragraphes, lignes courtes) affichée en
   carte ET injectée dans le prompt de proposition, pour expliquer les plafonds
   bas et orienter les séparateurs dès le tour 1.

**Invariants conservés** : zéro connexion API à Dify, zéro stockage serveur
(le client re-poste le même PDF qu'il a encore en mémoire), rapport éphémère,
zéro migration.

## Décisions de cadrage (validées)

| Question | Décision |
|---|---|
| Comportement des tours | **Cumulatif** : le rapport affiché est celui du tour courant, mais Claude reçoit l'historique de TOUTES les configs testées (plafonné aux 30 dernières) et la carte recommandation montre le **meilleur score global tous tours confondus** |
| Transport du raffinement | Champ multipart optionnel `refine` (JSON) sur la route existante — pas de route séparée, pas de cache serveur |
| OCR au raffinement | Verdict du tour précédent réutilisé tel quel (étape affichée « Verdict OCR réutilisé ») |
| Diagnostic | Événement SSE dédié émis juste après l'extraction + injecté dans le prompt de proposition |
| Changement de fichier | Remet l'historique et le compteur de tours à zéro |

## 1. Types (`src/lib/embed-test/types.ts`)

Ajouts (module pur, conventions existantes) :

```ts
export type TextDiagnostic = {
  totalChars: number
  paragraphBreaks: number      // occurrences de \n{2,}
  lineBreaks: number           // occurrences de \n simples
  avgParagraphTokens: number   // 0 si aucun paragraphe
  shortLineRatio: number       // lignes < 40 chars / lignes totales (0..1)
  verdict: 'structured' | 'weakly_structured' | 'flat'
  notes: string[]              // explications FR générées par règles
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

/** Identité structurelle d'une config (dédup des propositions de Claude). */
export function configKey(c: ChunkConfig): string
// JSON.stringify des champs [mode, separator, maxTokens, overlapTokens,
// parentMaxTokens ?? null, childMaxTokens ?? null, preprocessing] — PAS label/rationale.
```

`EmbedTestEvent` += `| { type: 'diagnostic'; diagnostic: TextDiagnostic }`.
`parse.ts` : variante `diagnostic` ajoutée au discriminated union (mêmes bornes).

## 2. Diagnostic (`src/lib/embed-test/diagnostics.ts` — nouveau, pur)

`analyzeTextStructure(text: string): TextDiagnostic` :

- Paragraphes = split `/\n{2,}/`, lignes = split `/\n/` (vides exclues des deux).
- `avgParagraphTokens` via `countTokens` du chunker (gpt-tokenizer, côté Dify).
- **Règles de verdict (déterministes, dans cet ordre)** :
  - `flat` si `paragraphBreaks === 0` (texte sans aucun saut de paragraphe) ;
  - `weakly_structured` si `avgParagraphTokens > 500` OU `shortLineRatio > 0.5` ;
  - `structured` sinon.
- **Notes FR par règle déclenchée** (cumulables) :
  - paragraphBreaks === 0 → « Aucun saut de paragraphe (\n\n) détecté — les séparateurs paragraphe ne matcheront jamais, préférez \n ou un découpage par phrases. »
  - avgParagraphTokens > 500 → « Paragraphes très longs (~N tokens en moyenne) — ils seront re-découpés brutalement par tokens. »
  - shortLineRatio > 0.5 → « Majorité de lignes courtes — texte probablement issu d'un tableau ou d'une mise en page colonne, structure peu fiable. »
  - verdict structured → « Texte bien structuré — les séparateurs paragraphe devraient fonctionner. »

`diagnosticPromptSummary(d: TextDiagnostic): string` — rendu compact FR pour le
prompt de proposition (verdict + métriques clés + notes).

## 3. Claude (`src/server/embed-test/claude.ts`)

`proposeConfigs` gagne un paramètre optionnel :

```ts
extras?: { diagnosticSummary?: string; tested?: TestedConfig[] }
```

- `diagnosticSummary` injecté avant le document : « --- DIAGNOSTIC DU TEXTE EXTRAIT ---\n… ».
- `tested` rendu en bloc : « --- CONFIGS DÉJÀ TESTÉES (ne JAMAIS re-proposer une config identique) ---\n- [tour 1] "label" (général, sep "\n\n", 1024 tk, overlap 128) → 3,2/10 — problèmes : … » ; consigne ajoutée au prompt : « Propose des configurations NOUVELLES qui corrigent les problèmes relevés ci-dessus. »
- **Dédup code-side** (défense en profondeur) : après validation zod, les configs proposées dont le `configKey` existe dans `tested` sont droppées ; le seuil « < 2 survivantes → throw » existant s'applique.

Tool schema inchangé. Aucun nouvel appel.

## 4. Pipeline (`src/server/embed-test/pipeline.ts`)

Signature : `runEmbedTest(buffer, modelKey, emit, refine?: RefinePayload)`.

1. Extraction (inchangé).
2. **NOUVEAU** : `analyzeTextStructure(fullText)` → `emit({type:'diagnostic', …})`.
3. OCR : si `refine` fourni → `ocr = refine.ocr`, émettre `step` « Verdict OCR réutilisé (tour précédent) », AUCUN appel vision ni buildPdfSample. Sinon comportement actuel.
4. Propose : passer `{ diagnosticSummary: diagnosticPromptSummary(diagnostic), tested: refine?.tested }`.
5. Judge + rapport : inchangés (le rapport reste celui du tour courant ; le cumul est côté client).

## 5. Route (`src/app/api/admin/embed-test/route.ts`)

Champ multipart optionnel `refine` :
- absent → comportement actuel ;
- présent : doit être une string ≤ 64 Ko (sinon 400 `invalid_refine`), `JSON.parse` + `refinePayloadSchema.safeParse` → 400 `invalid_refine` si échec ;
- valide → passé à `runEmbedTest(buffer, model, emit, refine)`.

Gardes existantes inchangées (ordre auth → role → clé → form).

## 6. Hook (`src/lib/embed-test/useEmbedTest.ts`)

État étendu :

```ts
diagnostic: TextDiagnostic | null
round: number                 // 0 idle, 1 au premier run, +1 par raffinement
history: TestedConfig[]       // cumul de tous les tours
bestSoFar: { config: ChunkConfig; score: number; rationale: string;
             round: number; ocr: OcrVerdict } | null
```

- `run(file, model, refine?: RefinePayload)` — le champ `refine` est sérialisé
  dans le FormData. Au démarrage d'un run : `round` = précédent + 1 (1 si reset),
  `steps/configs/results/report/diagnostic` réinitialisés, `history`/`bestSoFar`
  **conservés**.
- Reducer `applyEvent` : nouvelle variante `diagnostic` ; à l'événement `report`,
  (a) appendre à `history` les entrées du tour courant (config + score + issues +
  failed + round), (b) mettre à jour `bestSoFar` si le meilleur du tour bat le
  score global (en cas d'égalité, le plus ancien gagne).
- `buildRefinePayload(state): RefinePayload | null` (helper pur exporté, testé) :
  `{ ocr: state.report.ocr, tested: state.history.slice(-30) }` — null si pas de
  rapport.
- `reset()` remet TOUT à zéro (round, history, bestSoFar inclus).

## 7. UI (`src/components/admin/EmbedTestAdmin.tsx`)

- **Carte « Structure du texte extrait »** (entre timeline et rapport, dès
  l'événement reçu) : badge verdict (Structuré ✅ / Peu structuré ⚠️ / Plat 🚫),
  métriques (paragraphes, tokens moyens/paragraphe, ratio lignes courtes), notes.
- **Bouton « Raffiner (tour N+1) »** dans la carte rapport : visible quand
  `status === 'done'`, désactivé avec hint FR si le fichier n'est plus
  sélectionné (« Resélectionnez le PDF pour raffiner »). Clic →
  `run(file, model, buildRefinePayload(state))`.
- **Indicateur de tour** : « Tour N » dans le titre du tableau + ligne de
  synthèse « X configs testées au total » quand round > 1.
- **Carte recommandation = meilleur GLOBAL** : si `bestSoFar.round` ≠ tour
  courant, titre « Recommandation — meilleure config (tour N) » et
  `formatDifySettings(bestSoFar.config, bestSoFar.ocr)` recalculé client-side
  (fonction pure déjà partagée). Sinon comportement actuel.
- **Changement de fichier** (`onChange` input) : appelle `reset()` (nouveau
  document = nouvelle session de tours) puis pose le fichier.

## 8. Gestion d'erreurs

| Cas | Comportement |
|---|---|
| `refine` non-string / > 64 Ko / JSON invalide / schéma KO | 400 `invalid_refine` côté serveur ; côté client le 400 garde le message générique existant de `httpErrorText` (pas de nouveau mapping — le cas est inatteignable via l'UI) |
| Toutes les propositions raffinées déjà testées (dédup → <2) | throw existant → `propose_failed` (FR « La proposition de configurations… a échoué ») — acceptable, l'admin relance |
| Fichier désélectionné avant Raffiner | Bouton désactivé + hint (jamais d'appel) |

## 9. Tests (vitest, conventions du repo)

- `diagnostics.ts` : seuils exacts des 3 verdicts, notes par règle, texte vide.
- `types.ts` : `refinePayloadSchema` (bornes 1-30, ocr requis), `configKey`
  (identité indépendante de label/rationale ; parent-child distinct de general).
- `claude.ts` : prompt contient le bloc diagnostic et le bloc historique quand
  fournis ; dédup droppe une config identique re-proposée ; throw si <2 après dédup.
- `pipeline.ts` : refine → ocrCompare JAMAIS appelé + verdict propagé au rapport ;
  événement `diagnostic` émis dans tous les runs ; extras passés à proposeConfigs.
- `route.ts` : refine valide accepté et transmis ; refine malformé → 400 ;
  oversize → 400.
- `useEmbedTest` : reducer diagnostic ; history append au report ; bestSoFar
  cross-tours (tour 2 moins bon ne remplace pas) ; `buildRefinePayload` ;
  reset complet.
- `parse.ts` : événement diagnostic valide/invalide.
- Composant : carte diagnostic rendue ; bouton Raffiner visible à done.

## 10. Hors périmètre

- Persistance des tours en base (toujours éphémère).
- Re-proposition d'OCR au raffinement (verdict figé au tour 1).
- Limite dure du nombre de tours (le coût borné par tour suffit ; l'historique
  envoyé est plafonné à 30 configs).
