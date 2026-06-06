# Labo d'embed — banc d'essai des paramètres d'ingestion Dify

**Date** : 2026-06-06
**Statut** : spec validée (brainstorming), en attente de plan d'implémentation

## Objectif

Outil admin-only qui aide à choisir les bons paramètres d'ingestion d'un document
dans la base de connaissance Dify (chat BRAIN). L'admin upload un PDF, l'outil
teste plusieurs configurations via l'API Claude (extraction OCR vs texte basique,
taille de chunk, overlap, séparateur, mode General vs Parent-child) et produit
une recommandation **à reporter manuellement dans l'UI Dify**.

**Hors périmètre — explicite** : aucune connexion API formaps → Dify. Ni clé
Knowledge, ni endpoint datasets, ni écriture dans Dify. L'outil est un banc
d'essai autonome ; Dify reste paramétré à la main par l'admin. Les clés
`DIFY_API_URL`/`DIFY_API_KEY` existantes ne sont pas touchées.

## Décisions de cadrage (validées)

| Question | Décision |
|---|---|
| Méthode d'évaluation | **Juge de chunks** : Claude note la cohérence structurelle de chaque config (phrases coupées, idées fragmentées, tableaux cassés, chunks orphelins). Pas de Q&A simulé. |
| Formats acceptés | **PDF uniquement** (seul format où la question OCR se pose) |
| Configs testées | **Claude propose** : analyse de la structure du document puis 4-6 configs pertinentes |
| Persistance | **Rapport éphémère** : affiché à l'écran, rien en base, perdu au refresh (assumé). Zéro migration. |
| Modèle Claude | **Sélecteur dans l'UI** : Sonnet 4.6 (défaut) / Opus 4.8, facturé à l'usage via `ANTHROPIC_API_KEY` |
| Architecture | **Route handler multipart + SSE** (approche A) : assemblage des deux patterns prouvés en prod — upload multipart 25 Mo (route documents formations) + streaming SSE (route `/api/brain`) |

## 1. Infra & dépendances

- Nouvelles dependencies : `@anthropic-ai/sdk`, `unpdf` (extraction texte PDF),
  `gpt-tokenizer` (comptage tokens, même famille que le compteur Dify).
- Nouvel env : `ANTHROPIC_API_KEY` — ajouté à `.env.example`,
  `docker-compose.yml` (service web) et documenté dans `docs/DEPLOY.md`.
- Clé absente → la route répond **503** avec message FR clair avant tout travail.
- Modèles : `claude-sonnet-4-6` (défaut) et `claude-opus-4-8`, ids centralisés
  dans une constante serveur (pas de littéraux dispersés).
- Aucune migration DB.

## 2. Route — `POST /api/admin/embed-test`

`src/app/api/admin/embed-test/route.ts`, `runtime = 'nodejs'`.

- **Garde admin inline** comme `src/app/api/admin/formations/[id]/documents/route.ts` :
  `auth()` puis `session?.user?.role !== 'admin'` → 403 (le matcher middleware
  exclut `/api`, chaque route API se garde elle-même). Non connecté → 401.
- **Entrée** : `req.formData()` multipart — champ `file` (PDF) + champ `model`
  (`'sonnet' | 'opus'`, défaut `sonnet`, valeur inconnue → 400).
- **Validations** : `application/pdf` sinon **415** ; taille max **25 Mo**
  sinon **413** (mêmes codes que l'upload documents).
- **Sortie** : stream SSE (`Content-Type: text/event-stream`) — voir §5.
- Le PDF reste en mémoire le temps du run, rien n'est écrit sur disque
  (pas d'usage du volume `cockpit_uploads`).

## 3. Modules serveur — `src/server/embed-test/`

### `extract.ts`
`extractPages(buffer): Promise<{ pages: string[]; totalPages: number }>` via
`unpdf`. Texte page par page (nécessaire pour comparer avec la vision sur les
mêmes pages). PDF chiffré ou illisible → erreur typée dédiée.

### `chunker.ts` — fonctions PURES (cœur testable)
Simule le chunking Dify :

- `chunkText(text, config)` : split sur `separator` → fusion/découpe pour
  respecter `maxTokens` → application de `overlapTokens`. Comptage tokens via
  `gpt-tokenizer`.
- Mode **Parent-child** : split 2 niveaux — chunks parents (`parentMaxTokens`)
  puis sous-chunks enfants (`childMaxTokens`) ; le jugement porte sur les
  enfants avec leur parent en contexte.
- Type `ChunkConfig` : `{ mode: 'general' | 'parent-child'; separator: string;
  maxTokens: number; overlapTokens: number; parentMaxTokens?: number;
  childMaxTokens?: number; preprocessing: { removeExtraSpaces: boolean;
  removeUrlsEmails: boolean } }` — champs alignés sur les options exposées par
  l'UI Dify (Général/Parent-enfant, délimiteur, longueur max, chevauchement,
  règles de prétraitement).
- Cas limites spécifiés : `overlapTokens >= maxTokens` rejeté à la validation ;
  séparateur absent du texte → fallback découpe par tokens ; texte vide → `[]`.

### `claude.ts` — 3 appels typés (sorties structurées via tool use)
Wrapper du SDK Anthropic. Chaque appel force un tool `output` avec schéma JSON
strict (pas de parsing de prose).

1. `ocrCompare(sampledPdfPages, nativeTextSamePages)` → `{ verdict:
   'text_ok' | 'ocr_needed'; reason: string; coverage: number }`. Les pages
   échantillonnées sont envoyées en **document block PDF** (vision) ; Claude
   compare ce qu'il lit visuellement au texte natif extrait des mêmes pages.
2. `proposeConfigs(textSample, docStats)` → `{ configs: ChunkConfig[] }`
   (4 à 6, bornes validées côté serveur : `maxTokens` 100-4000, overlap 0-50 %).
3. `judgeConfig(configLabel, sampledChunks)` → `{ score: number /*0-10*/;
   issues: string[]; summary: string }`.

Erreur API : **un retry** avec backoff sur 429/5xx, puis échec. Rapporte
`usage` (input/output tokens) de chaque appel pour le cumul affiché.

### `pipeline.ts` — orchestration
`runEmbedTest(buffer, model, emit)` où `emit(event)` pousse les événements SSE.
Étapes :

1. Extraction texte natif (toutes pages).
2. Échantillonnage **5 pages** (première, dernière, 3 réparties) → `ocrCompare`.
3. `proposeConfigs` sur le texte tronqué à **80 000 caractères**.
4. Pour chaque config : `chunkText` local puis `judgeConfig` sur un
   **échantillon de 15 chunks max** (début/milieu/fin). Les configs sont
   jugées séquentiellement ; un échec marque la config `failed` et le run
   continue.
5. Rapport final : verdict OCR, classement par score, recommandation =
   meilleure config reformulée dans les termes UI Dify, cumul tokens.

Si le verdict est `ocr_needed`, le texte natif est jugé peu fiable : le
pipeline continue (le chunking reste comparatif) mais le rapport l'annonce en
tête et la recommandation commence par « Activez le pipeline OCR dans Dify ».

**Garde-fous coût** (constantes nommées) : 5 pages vision, 80k chars analyse,
15 chunks jugés/config, 6 configs max.

## 4. Sécurité

- Route et page accessibles **admin uniquement** (garde route + layout
  `src/app/admin/layout.tsx` + middleware, défense en profondeur).
- Le contenu du document part vers l'API Anthropic (externe) : mention claire
  dans l'UI à côté du bouton Lancer (« Le document est analysé par l'API
  Claude d'Anthropic »).
- `ANTHROPIC_API_KEY` server-only (jamais importée côté client — même
  convention que `src/server/dify/client.ts`).
- Pas de stockage du fichier ni du rapport.

## 5. Protocole SSE

Événements `data: {json}` :

| Événement | Payload | Quand |
|---|---|---|
| `step` | `{ type:'step', id, label }` | début de chaque étape (extraction, ocr, propose, judge:i, report) |
| `configs` | `{ type:'configs', items: ChunkConfig[] }` | configs proposées par Claude |
| `config-result` | `{ type:'config-result', index, score, issues, summary, chunkCount, failed? }` | au fil des jugements |
| `report` | `{ type:'report', ocr:{verdict,reason}, ranking:[…], recommendation:{configIndex, difySettings:string, rationale}, usage:{inputTokens,outputTokens} }` | fin de run |
| `error` | `{ type:'error', code, message }` | erreur fatale (FR, exploitable) |

`recommendation.difySettings` = texte prêt à copier, vocabulaire UI Dify, ex. :
« Mode : Général · Délimiteur : \n\n · Longueur max : 1024 tokens ·
Chevauchement : 128 tokens · Prétraitement : remplacer espaces consécutifs ✓ ·
Pipeline : extraction texte (OCR inutile) ».

Parsing côté client : réutilise `parseSSELines` de `src/lib/dify/parse.ts`
(extraction des lignes `data:`) avec un parseur d'événements propre au labo
dans `src/lib/embed-test/parse.ts` (pur, partagé, testable — même convention
que `src/lib/dify/parse.ts`).

## 6. UI — `/admin/embed-test`

- `src/app/admin/embed-test/page.tsx` : server shell mince (convention admin).
- `src/components/admin/EmbedTestAdmin.tsx` (`'use client'`) + hook
  `src/lib/embed-test/useEmbedTest.ts` (même mécanique de lecture de stream
  que `useBrainChat`).
- Lien « Labo d'embed » dans `AdminNav`.

Écran :

1. **Formulaire** : zone upload PDF (≤ 25 Mo), sélecteur modèle
   (Sonnet 4.6 défaut / Opus 4.8 + mention indicative du coût), mention
   d'envoi à l'API Anthropic, bouton « Lancer le test » (désactivé pendant
   un run).
2. **Timeline de progression** en direct : étapes cochées au fil des `step`,
   configs jugées au fil des `config-result`.
3. **Rapport** :
   - carte **verdict OCR** (« Extraction texte suffit » / « Passez par le
     pipeline OCR » + justification) ;
   - **tableau des configs classées** : mode, délimiteur, longueur max,
     chevauchement, score /10, problèmes relevés (config `failed` affichée
     grisée) ;
   - carte **recommandation finale** (`difySettings`) avec bouton **copier** ;
   - cumul tokens consommés.
4. Erreur fatale → message FR + bouton relancer. Refresh = tout est perdu
   (éphémère, assumé).

Mapping erreurs FR côté client (convention `FormationDocumentsAdmin`) :
413 → « Fichier trop volumineux (25 Mo max) », 415 → « Seuls les PDF sont
acceptés », 503 → « Clé API Anthropic non configurée », etc.

## 7. Gestion d'erreurs

| Cas | Comportement |
|---|---|
| Non connecté / non admin | 401 / 403 avant lecture du body |
| Pas un PDF / trop gros | 415 / 413 |
| `ANTHROPIC_API_KEY` absente | 503 + message FR |
| PDF chiffré / couche illisible | événement `error` dédié (« PDF illisible — protégé ou corrompu ») |
| API Claude down / 429 | 1 retry backoff, puis `error` FR |
| Échec jugement d'UNE config | config `failed`, run continue |
| Échec extraction ou proposeConfigs | `error` fatal, run interrompu |

## 8. Tests (vitest, conventions du repo)

- **`chunker.ts`** (le gros morceau, pur) : respect maxTokens/overlap,
  séparateur absent → fallback, overlap ≥ maxTokens rejeté, parent-child
  2 niveaux, prétraitement, texte vide.
- **`parse.ts` embed-test** : tous les types d'événements + lignes corrompues.
- **Route** : 401/403, 415/413, 400 modèle inconnu, 503 sans clé (auth mockée
  comme les tests routes existants).
- **`pipeline.ts`** avec `claude.ts` mocké : run nominal, échec partiel d'une
  config, échec total, verdict ocr_needed propagé au rapport.
- **`useEmbedTest`** : accumulation des événements, état d'erreur (convention
  `useBrainChat.test.ts`).

## 9. Hors périmètre / suites possibles

- Historique des runs en base (si le besoin de comparer des documents émerge).
- Q&A simulé en complément du juge de chunks.
- Autres formats (.docx, tableurs).
- Test des paramètres de **retrieval** Dify (top_k, seuil, hybrid) — l'outil
  ne couvre que l'ingestion.
