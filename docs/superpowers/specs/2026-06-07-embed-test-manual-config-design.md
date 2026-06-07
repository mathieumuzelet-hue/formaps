# Labo d'embed v2.1 — Config manuelle + calibrage du juge + affichage séparateur

**Date** : 2026-06-07
**Statut** : spec validée (échange direct), en attente de plan

## Objectif

Trois corrections issues de l'usage réel (doc plat « Book-L'INVENTAIRE GENERAL 2.pdf ») :

1. **« Tester ma config »** : l'admin saisit lui-même séparateur/taille/overlap/mode —
   l'outil chunk + juge CETTE config (1 seul appel judge, pas de propose, OCR réutilisé)
   et l'intègre aux tours (historique, meilleur global, raffinement suivant).
2. **Calibrage du juge** : le juge reçoit les paramètres de la config évaluée + le verdict
   du diagnostic, avec consignes : les répétitions entre chunks consécutifs sont l'effet
   VOULU du chevauchement (ne pas pénaliser) ; sur texte sans structure, juger la qualité
   RELATIVE du compromis, pas l'idéal absolu. Motif : le juge sanctionnait l'overlap comme
   « doublons » → biais mécanique contre les configs à fort overlap.
3. **Affichage séparateur** : échapper les retours à la ligne réels (`\n` littéral) dans la
   carte recommandation ET la colonne Délimiteur du tableau (défaut avéré en prod : Claude
   a renvoyé un séparateur avec un vrai newline → carte cassée).

## 1. Types

`refinePayloadSchema` += `manual: chunkConfigSchema.optional()`. Quand `manual` est présent,
le pipeline saute la proposition et juge uniquement cette config. `tested` reste requis
(min 1) — le mode manuel n'est accessible qu'après un premier run (il réutilise l'OCR).

## 2. Chunker

Nouvelle fonction pure `escapeSeparator(s: string): string` (inverse de
`normalizeSeparator`) : `\n` réel → `\\n`, `\t` réel → `\\t`, idempotente sur les formes
déjà échappées (ne double-échappe pas un `\\n` existant). Utilisée par `formatDifySettings`
et par la colonne Délimiteur de l'UI.

## 3. Claude — `judgeConfig`

Signature : `judgeConfig(client, model, config: ChunkConfig, chunks, diagnosticVerdict: TextDiagnostic['verdict'])`
(remplace `configLabel: string`). Le prompt gagne :
- un en-tête « CONFIG ÉVALUÉE : mode X, séparateur "…" (échappé), longueur max N tk,
  chevauchement M tk[, parent P / enfant E] » ;
- la consigne overlap : « Le chevauchement recopie volontairement la fin du chunk précédent
  au début du suivant — ces répétitions sont un mécanisme RAG voulu, ne les compte PAS
  comme défaut. » ;
- la consigne relative quand `diagnosticVerdict !== 'structured'` : « Le texte source est
  sans structure exploitable — note la qualité RELATIVE du compromis de découpage pour ce
  texte, pas l'écart à un idéal de document structuré. »

## 4. Pipeline

`if (refine?.manual)` : étape propose remplacée par
`emit step « Config manuelle fournie — proposition sautée »` + `configs = [refine.manual]`
(aucun appel propose). Judge reçoit désormais `(config, chunks, diagnostic.verdict)` sur
tous les chemins. Coût d'un tour manuel : 1 appel judge.

## 5. Hook + UI

- `buildManualPayload(state, config): RefinePayload | null` — comme `buildRefinePayload`
  avec `manual: config` (null sans rapport).
- Formulaire repliable « Tester ma config » visible à `status === 'done'` (à côté de
  Raffiner) : mode (Général/Parent-enfant), séparateur (texte, défaut `\n\n` échappé),
  longueur max (number), chevauchement (number), tailles parent/enfant si parent-enfant,
  2 cases prétraitement. Label auto « Manuelle (N tk / M ov) ». Validation client via
  `chunkConfigSchema.safeParse` → messages FR inline (bornes 100-4000, overlap < taille).
  Soumission → `run(file, model, buildManualPayload(state, config))`.
- Colonne Délimiteur du tableau : `escapeSeparator(config.separator)`.
- Le tour manuel s'affiche comme un tour normal (tableau 1 ligne, reco globale inchangée
  si le score ne bat pas le meilleur).

## 6. Erreurs & tests

`manual` invalide → 400 `invalid_refine` (schéma). Tests : types (manual optionnel),
escapeSeparator (réel/échappé/idempotence/###), judgeConfig (en-tête config + consigne
overlap + consigne relative selon verdict), pipeline (manual → propose jamais appelé,
1 judge, configs=[manual]), hook (buildManualPayload), UI (formulaire rendu à done,
validation FR, colonne échappée).

## Hors périmètre

Config manuelle au tour 1 (exigerait l'appel vision) ; presets de configs ; édition d'une
config proposée par Claude.
