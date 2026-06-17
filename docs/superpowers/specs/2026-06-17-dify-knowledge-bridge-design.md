# Spec — Pont APS → Dify Knowledge (alimenter les datasets depuis le Cockpit)

Date : 2026-06-17
Origine : besoin produit — alimenter les bases de connaissances Dify de BRAIN directement depuis l'interface APS (Cockpit), au lieu de l'export CSV manuel + import console Dify.

## Objectif

Permettre à un admin de **pousser du contenu APS vers les datasets Dify** depuis le
Cockpit, avec un déclenchement explicite et un suivi d'état idempotent.

Sens unique : **APS → Dify** (écriture). Hors scope : lecture/retrieval inverse,
gestion CRUD complète des datasets, propagation automatique au save.

## Contexte existant

- Intégration Dify actuelle = **App API uniquement** (`src/server/dify/client.ts` :
  `chat-messages`, `feedbacks`), via `DIFY_API_KEY`. Aucun accès aux datasets.
- Les datasets (`kb_outils_itm_mercalys`, `OCR`, `MASTER_FORMATIONS`, `Q&A`) sont
  gérés exclusivement dans la console Dify.
- Le FAQ builder produit des `faqDrafts` (`faq_drafts.items: FaqItem[]`,
  `FaqItem = { id, question, answer, origin }`) exportés aujourd'hui en CSV
  (`src/lib/admin/faq-csv.ts`) puis ré-importés à la main dans le dataset Q&A.
- Les documents de formation sont en table `formation_documents`
  (`id, formationId, title, pages, sizeLabel, fileUrl, isNew, order`) — le PDF est
  accessible via `fileUrl`.

## Décisions de cadrage (validées 2026-06-17)

1. **Sources** : (a) FAQ builder → dataset Q&A ; (b) PDF Formations → dataset documents.
2. **Déclenchement** : bouton explicite + suivi d'état (re-push = update, suppression
   propagée). Pas de hook automatique au save.
3. **Stockage de l'état** : **table dédiée `dify_sync`** (approche B), pas de colonnes
   sur les tables source. Le pont est un sous-système isolé.
4. **Mapping FAQ** : **1 draft = 1 document Dify** nommé d'après `sourceFilename` ;
   chaque `FaqItem` = un **segment** `{ content: question, answer: réponse }` (le
   dataset Q&A est en mode Q&A).

## Architecture

```
Cockpit admin (faq-builder/[id], formations/[id])
        │  bouton "Pousser vers Dify"
        ▼
tRPC router difySync (adminProcedure)
        ├─ src/server/dify/knowledge.ts   ← NOUVEAU client Knowledge API (clé dataset)
        └─ table dify_sync                ← mapping source → dify_document_id + état
```

Le client Knowledge est **distinct** de `client.ts` (App API). Il réutilise
`DIFY_API_URL` mais une **clé dataset séparée** `DIFY_DATASET_API_KEY`, et applique
les mêmes garde-fous que l'existant (timeout `fetch` borné, erreurs typées, `fetch`
injectable pour les tests).

## Composants

### 1. Configuration (env)

Nouvelles variables, à poser dans Dokploy **et** à mapper dans le bloc `environment:`
du service web du compose (règle env→compose) :

- `DIFY_DATASET_API_KEY` — clé API Knowledge Dify (type *dataset*).
- `DIFY_QA_DATASET_ID` — id du dataset Q&A cible.
- `DIFY_DOCS_DATASET_ID` — id du dataset documents cible (MASTER_FORMATIONS ou OCR).

`DIFY_API_URL` est réutilisé. Si la clé/les ids manquent, les procédures renvoient une
erreur explicite (`dify_knowledge_not_configured`), à l'image de
`anthropic_not_configured`.

### 2. Client Knowledge — `src/server/dify/knowledge.ts`

Fonctions exportées (toutes bornées par un timeout, ex. `KNOWLEDGE_TIMEOUT_MS = 30_000`
pour l'upload de fichier, `10_000` pour le reste) :

- `createDocumentByText(datasetId, name, text, processRule?)` →
  `POST /v1/datasets/{datasetId}/document/create-by-text`. Retourne
  `{ documentId, batch }`.
- `addSegments(datasetId, documentId, segments)` →
  `POST /v1/datasets/{datasetId}/documents/{documentId}/segments`, chaque segment
  `{ content, answer }`. Pour le re-push, `replaceSegments` supprime puis recrée
  (MVP : delete document + recreate, plus simple que la diff segment-à-segment).
- `createDocumentByFile(datasetId, name, bytes, processRule?)` →
  `POST /v1/datasets/{datasetId}/document/create-by-file` (multipart : champ `data`
  JSON + champ `file`). Retourne `{ documentId, batch }`.
- `updateDocumentByFile(datasetId, documentId, name, bytes)` →
  `POST /v1/datasets/{datasetId}/documents/{documentId}/update-by-file`.
- `deleteDocument(datasetId, documentId)` →
  `DELETE /v1/datasets/{datasetId}/documents/{documentId}`.
- (optionnel v2) `indexingStatus(datasetId, batch)` →
  `GET /v1/datasets/{datasetId}/documents/{batch}/indexing-status`.

`processRule` MVP : `{ mode: 'automatic' }`, `indexing_technique: 'high_quality'`.
Erreurs : `DifyKnowledgeError` typée (status + corps), jamais de throw silencieux.

> **À vérifier avant d'implémenter le client** : la Knowledge API Dify varie selon
> la version de l'instance (chemins `document/create-by-text` vs `documents`, forme
> du multipart `create-by-file`, sémantique des segments Q&A). La première tâche du
> plan doit confirmer les endpoints/payloads exacts contre l'instance live
> (`DIFY_API_URL`) ou la doc de sa version, et notamment **comment pousser des paires
> Q/R connues sans auto-génération** (create document + `segments` explicites, vs
> `create-by-text` qui auto-extrait). Ne pas coder le client sur des suppositions.

### 3. Table `dify_sync` (Drizzle + migration générée)

```
dify_sync
  id            uuid pk
  sourceType    text   -- 'faq_draft' | 'formation_doc'
  sourceId      uuid   -- faqDrafts.id | formationDocuments.id
  datasetId     text   -- dataset Dify ciblé (résolu depuis l'env au push)
  difyDocumentId text  -- nullable tant que pas synchronisé
  status        text   -- 'pending' | 'synced' | 'failed'
  error         text   -- nullable, message d'échec
  syncedAt      timestamp -- nullable
  createdAt/updatedAt timestamp
  UNIQUE (sourceType, sourceId)
```

Enum applicatif (zod) pour `sourceType`/`status` ; au niveau DB on peut utiliser
`pgEnum` (cohérent avec le repo). La table ne référence pas les tables source par FK
(le sourceId est polymorphe) — la cohérence est gérée applicativement (unsync au
delete de la source).

### 4. Router tRPC `difySync` (adminProcedure)

- `pushFaq(draftId)` : lit le draft, mappe `items` → segments, crée/maj le document
  Dify, upsert `dify_sync` (`status` → `synced`/`failed`). Idempotent : si une ligne
  existe avec `difyDocumentId`, on remplace le contenu de CE document.
- `pushFormationDoc(docId)` : lit `formationDocuments`, télécharge le PDF depuis
  `fileUrl`, `create-by-file`/`update-by-file`, upsert `dify_sync`.
- `unsync({ sourceType, sourceId })` : `deleteDocument` Dify (best-effort, loggé) puis
  suppression de la ligne `dify_sync`.
- `status({ sourceType, sourceIds })` : retourne l'état pour l'affichage des badges.

### 5. UI

- `admin/faq-builder/[id]` : bouton « Pousser vers Dify » + badge (synced/en attente/
  échec, date). Le bouton CSV existant reste (fallback).
- `admin/formations/[id]` : par document, bouton « Pousser vers Dify » + badge.
- Au delete d'un draft / document de formation : appeler `unsync` (best-effort).

## Flux de données

**FAQ** : draft → 1 document Dify (`name = sourceFilename` ou titre), `items` →
segments `{ content: question, answer: answer }`. Re-push : on connaît
`difyDocumentId` → delete+recreate document (MVP) → `synced`.

**PDF Formation** : `formationDocuments.fileUrl` → fetch bytes → `create-by-file`
(ou `update-by-file` si déjà `difyDocumentId`) en mode `automatic` → `synced`.
*(Tie-in futur hors MVP : réutiliser la config recommandée par le Labo d'embed comme
`process_rule` custom.)*

## Gestion d'erreur

- Échec d'un appel Knowledge → `dify_sync.status = 'failed'` + `error` stocké ;
  la source (draft/document) **n'est pas** affectée (découplage total). Badge rouge,
  re-push possible.
- Indexation Dify asynchrone : après un create/update HTTP 200, on marque `synced`
  (le document est accepté ; l'indexation se termine côté Dify). Le suivi fin de
  l'indexation (`indexing-status`) est **v2 optionnel**.
- `unsync` best-effort : si le `DELETE` Dify échoue (déjà supprimé), on loggue et on
  purge quand même la ligne locale.
- Tous les `fetch` Knowledge sont bornés par timeout (jamais de hang de la mutation
  tRPC).

## Tests

- **Client Knowledge** (`fetch` fake) : URL/headers/payload corrects pour
  create-by-text, create-by-file (multipart : champs `data`+`file`), segments, delete ;
  `DifyKnowledgeError` sur 4xx/5xx ; respect du timeout (abort).
- **Mapping FAQ→segments** : helper pur, `FaqItem[]` → `{content,answer}[]`.
- **Router difySync** : push crée la ligne `dify_sync` (`synced`) ; 2e push = update
  du même `difyDocumentId` (idempotence, pas de doublon) ; échec client → `failed` +
  error ; `unsync` supprime la ligne et appelle `deleteDocument`.
- **Config absente** → `dify_knowledge_not_configured`.

## Prérequis (déploiement, pas implémentation)

- Créer une **clé API Knowledge** dans Dify (type dataset).
- Renseigner `DIFY_DATASET_API_KEY`, `DIFY_QA_DATASET_ID`, `DIFY_DOCS_DATASET_ID`
  (Dokploy + compose).

## Phasage

- **Phase 1** : config + client Knowledge + table `dify_sync` + router + FAQ→Q&A + UI
  faq-builder. Remplace le CSV manuel.
- **Phase 2** : Formation PDF→docs + UI formations.

Même spec, deux lots dans le plan d'implémentation.

## Critères de succès

- Un admin pousse une FAQ vers le dataset Q&A en un clic ; re-push met à jour sans
  doublon ; suppression propagée à Dify.
- Un admin pousse un PDF de formation vers le dataset documents ; BRAIN peut le citer.
- État (synced/en attente/échec) visible dans l'UI ; échec push n'altère pas la source.
- App API existante (chat/feedback) inchangée ; clé dataset strictement séparée de la
  clé app.
- Suite verte, lint+tsc verts.

## Hors scope (explicite)

- Retrieval inverse (Dify interroge APS).
- CRUD complet des datasets (création/suppression de datasets).
- Push automatique au save (déclenchement = bouton uniquement).
- Suivi fin d'indexation (v2 optionnel).
- Migration timestamptz / refontes non liées.
