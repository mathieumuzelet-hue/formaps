# FAQ Builder — Design

**Date** : 2026-06-10
**Statut** : validé (brainstorming interactif, décisions utilisateur enregistrées)

## Objectif

Outil **admin-only** qui génère une FAQ depuis un document uploadé (Claude Sonnet 4.6,
clé `ANTHROPIC_API_KEY` du `.env`), permet de retoucher les questions/réponses dans un
éditeur persistant, puis exporte un **CSV au format Q&A de Dify** que l'admin uploade
manuellement dans Dify (Connaissances → Importer → mode Q&A ; embedding bge-m3 : la
question de chaque paire est embedée, idéal pour matcher les questions des salariés).

## Décisions utilisateur (brainstorming 2026-06-10)

| Sujet | Décision |
|---|---|
| Format d'export | **CSV mode Q&A Dify** (colonnes `question,answer`) |
| Persistance | **Brouillons en base** (survivent à la fermeture du navigateur) |
| Documents en entrée | **PDF + .docx** |
| Volume de Q/R | **Claude décide** (couverture complète du document) |
| Questions supplémentaires | **Oui** — bouton « Générer plus » (dédup + retry) |
| Architecture | **A** — POST multipart simple + brouillons tRPC (pas de SSE) |
| Modèle | `claude-sonnet-4-6` **fixe** (pas de sélecteur) |
| Accès | Admin uniquement |

## Données

Migration **0007 additive au boot** (pattern migrate.mjs existant). Table `faq_drafts` :

| Colonne | Type | Rôle |
|---|---|---|
| `id` | uuid PK | |
| `source_filename` | text | Nom du document d'origine (affichage) |
| `source_text` | text | Texte extrait du document — alimente « Générer plus » sans re-upload |
| `items` | jsonb | Tableau ordonné `{ id, question, answer, origin }` |
| `created_at`, `updated_at` | timestamp | |

`origin` ∈ `'generated' \| 'manual'`. Choix **jsonb** plutôt qu'une table fille :
outil mono-utilisateur, sauvegarde atomique (une mutation remplace la liste entière),
zéro jointure. `id` d'item = uuid généré côté serveur à la création de la paire.

## Génération initiale

Route `POST /api/admin/faq-builder` (multipart `file`, garde admin identique à
`/api/admin/embed-test`) :

1. **Validations** : extension (.pdf/.docx) + magic bytes (`%PDF` / `PK\x03\x04`),
   taille ≤ 25 Mo. Sinon 415.
2. **Extraction** : PDF → `unpdf` (réutilise `src/server/embed-test/extract.ts`),
   .docx → `mammoth` (`extractRawText`, **nouvelle dépendance**). Texte extrait
   < 200 caractères (après trim) → 422 avec message orientant vers le labo d'embed
   (document probablement scanné, vérifier le verdict OCR).
3. **Claude** : Sonnet 4.6, tool use forcé strict `{ pairs: [{question, answer}] }`,
   validation zod **par paire** (une paire invalide est écartée sans invalider le
   lot). 0 paire valide → erreur explicite, **aucun brouillon créé**.
   `ANTHROPIC_API_KEY` absente → 503 propre (pattern embed-test).
4. **Prompt** (français) : couverture complète du document ; questions formulées du
   point de vue d'un salarié A⁺SUPER ; **réponses autoportantes** — chaque réponse
   part seule dans Dify : interdiction de « voir la section X », sigles développés à
   la première occurrence ; volume laissé au jugement de Claude selon la richesse du
   document (typiquement 10-40 paires).
5. **Création du brouillon** en base (`source_text` inclus) → l'UI redirige vers
   l'éditeur.

### Refactor partagé

`forcedToolCall` + `createAnthropicClient` + `Usage` sont **extraits** de
`src/server/embed-test/claude.ts` vers un module partagé `src/server/claude-core.ts`.
`embed-test/claude.ts` les ré-importe — comportement byte-identical, tests embed-test
inchangés. Le module FAQ (`src/server/faq/claude.ts`) consomme le même cœur.

## « Générer plus »

Mutation tRPC admin `faqBuilder.generateMore({ draftId })` :

- Relit `source_text` + les questions existantes du brouillon.
- Prompt : paires **INÉDITES** uniquement, liste des questions déjà présentes fournie.
- **Dédup code** par clé normalisée (minuscules, trim, ponctuation retirée, espaces
  compactés) contre l'existant — la consigne prompt seule ne suffit pas
  (cf. feedback « LLM propose + dédup + retry »).
- Si tout est doublon : **un retry** avec bloc « PROPOSITIONS REJETÉES » listant les
  questions rejetées ; si le retry API échoue, on garde les survivantes de la
  tentative 1. 0 paire inédite après retry → erreur explicite, brouillon inchangé.
- Les paires neuves s'ajoutent **en fin de liste**, `origin: 'generated'`.

## tRPC (routeur `faqBuilder`, admin)

| Procédure | Rôle |
|---|---|
| `list` | Brouillons (id, sourceFilename, nb paires, updatedAt) |
| `get({ id })` | Brouillon complet (sans `source_text`) |
| `updateItems({ id, items })` | Remplace la liste entière (sauvegarde atomique) |
| `generateMore({ draftId })` | Cf. ci-dessus |
| `delete({ id })` | Supprime le brouillon |

La génération initiale reste une **route API** (multipart, hors tRPC), comme embed-test.

## UI

- **`/admin/faq-builder`** : liste des brouillons (nom du doc, nb paires, dernière
  modif, supprimer) + zone d'upload « nouveau document » (PDF/.docx). Pendant la
  génération (~30-60 s) : bouton désactivé + indicateur d'attente. Erreurs en bannière.
- **`/admin/faq-builder/[id]`** : l'éditeur. Une carte par paire — textarea question,
  textarea réponse, badge `générée`/`manuelle`, monter/descendre/supprimer. En tête :
  « Ajouter une paire » (origin manual), « Générer plus », « Enregistrer »
  (mutation `updateItems`), « Exporter CSV », compteur de paires. Garde
  `beforeunload` si modifications non sauvées (pattern NewsEditor). Encart rappelant
  la marche à suivre Dify (Connaissances → Importer → **mode Q&A**).
- Entrée « FAQ Builder » dans la nav admin, à côté de FAQ gaps.
- Labels a11y associés aux champs (acquis de la PR ⑤).

## Export CSV

- Côté client, utilitaire `downloadCsv` partagé existant ; colonnes `question,answer` ;
  quoting RFC 4180 ; UTF-8.
- **Pas de garde anti-formule Excel** sur cet export : fichier destiné à l'ingestion
  machine Dify, préfixer `'` polluerait les réponses. (À l'inverse de l'export
  faq-gaps, destiné à Excel — choix documenté ici.)
- Exporte les paires **sauvegardées** (l'UI invite à enregistrer si dirty).
- Nom : `faq-<slug-du-doc>-<YYYYMMDD>.csv`.

## Erreurs (récapitulatif)

| Cas | Réponse |
|---|---|
| Extension/magic bytes invalides | 415 |
| Extraction vide | 422 + message « document scanné ? vérifier au labo d'embed » |
| 0 paire valide (génération) | erreur explicite, pas de brouillon |
| 0 paire inédite (générer plus, après retry) | erreur explicite, brouillon inchangé |
| `ANTHROPIC_API_KEY` absente | 503 |
| Brouillon introuvable | 404 / NOT_FOUND |

Toutes affichées en bannière dans l'UI (role=status/alert).

## Tests (TDD, subagent-driven)

- Route multipart : `@vitest-environment node` (gotcha jsdom/FormData connu),
  cas 415/422/503/succès.
- `src/server/faq/claude.ts` : client fake — paires valides/invalides/vides, schéma.
- `generateMore` : dédup (question identique modulo casse/ponctuation), retry avec
  rejets, sauvetage tentative 1, ajout en fin de liste.
- Routeur tRPC : pattern caller existant (list/get/updateItems/delete + ownership admin).
- Éditeur RTL : édition, ajout, suppression, réordonnancement, dirty state, export.
- Util CSV : quoting RFC 4180 (virgules, guillemets, retours ligne).
- La CI (PR ②) gate le merge.

## Hors scope V1 (assumé)

- Verdict OCR/vision sur le PDF (le labo d'embed le fait déjà ; ici extraction texte seule).
- Push automatique vers l'API Dify (l'upload reste manuel, voulu).
- Multi-documents par brouillon ; catégories/sections de FAQ.
- Réglage du volume de questions à l'écran.
- .txt/.md en entrée (ajout trivial plus tard si besoin).
