# BRAIN — Logging des questions & vue FAQ-gaps

**Date** : 2026-06-05
**Statut** : spec validée (brainstorming), en attente de plan d'implémentation

## Objectif

Capturer chaque question posée dans le chat BRAIN avec les métadonnées de
récupération Dify et le feedback utilisateur, afin d'identifier les trous de la
FAQ : questions sans source pertinente ou jugées insatisfaisantes par les
utilisateurs.

## Adaptations aux consignes d'origine

Les consignes supposaient Prisma/Next 14 et une réponse Dify bloquante. Réalité
formaps, validée avec le client :

| Consigne | Décision |
|---|---|
| Modèle Prisma `ChatQuery` | Table Drizzle `chat_queries` dans `src/server/db/schema.ts` |
| Parsing d'une réponse JSON bloquante | Capture dans le stream SSE existant (`message_end`) |
| Route REST `POST /api/chat/feedback` | Mutation tRPC `brain.feedback` (`protectedProcedure`) |
| Migration manuelle en prod | Migration appliquée au boot (`scripts/migrate.mjs`, convention repo) — `CREATE TABLE` additif |
| UI feedback non spécifiée | Boutons 👍/👎 inclus dans ce sprint (sinon `feedback` reste vide) |
| « Regrouper les questions similaires si possible » | Normalisation simple + comptage (pas d'embeddings) |

## 1. Schéma — table `chat_queries`

Dans `src/server/db/schema.ts` :

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | `defaultRandom()` |
| `query` | text not null | la question utilisateur |
| `answer` | text not null | réponse Dify complète (concat des deltas) |
| `conversationId` | text not null | id de conversation Dify |
| `messageId` | text not null **unique** | id du message Dify — clé du feedback |
| `userId` | uuid FK → `users.id` | `onDelete: 'set null'`, nullable |
| `retrievalScoreMax` | real nullable | score max des sources ; null si aucune source |
| `retrievalCount` | integer not null | nombre de `retriever_resources` |
| `hasRelevantSource` | boolean not null | `retrievalScoreMax >= seuil` |
| `feedback` | text nullable | `'like'` / `'dislike'` / null |
| `createdAt` | timestamp not null | `defaultNow()` |

Index : `createdAt`, `hasRelevantSource`, `feedback`.
Migration générée par drizzle-kit, appliquée automatiquement au boot.

## 2. Parsing — extension de `parseDifyEvent`

`src/lib/dify/parse.ts`, sur l'événement `message_end`, exposer en plus
(champs optionnels de `DifyParsed`, rétro-compatibles) :

- `messageId` : champ `id` de l'événement.
- `scores` : tableau des `score` numériques des `retriever_resources`
  (entrées sans score ignorées).

Le hook client existant ignore les champs qu'il ne connaît pas — aucun impact.

## 3. Capture — `src/app/api/brain/route.ts`

L'inspecteur `TransformStream` existant (qui capture déjà `conversation_id`)
accumule en plus :

- `answer` : concaténation des `answerDelta`.
- au `message_end` : `messageId`, `retrievalCount` (longueur du tableau),
  `retrievalScoreMax` (max des `scores`, `null` si tableau vide),
  `hasRelevantSource` (`scoreMax >= FAQ_RELEVANCE_THRESHOLD`, défaut `0.5`,
  env parsée à la requête ; `false` si aucun score).

Persistance dans le callback `flush()` du TransformStream :

- `INSERT INTO chat_queries` en fire-and-forget
  (`void Promise.resolve(...).catch(...)`) — **jamais** bloquant, échec loggé
  via `console.error('[brain] log chat_queries a échoué', err)` sans affecter
  la réponse.
- Si le stream se termine **sans** `message_end` (interruption, erreur
  modèle) : pas d'enregistrement — une réponse incomplète est du bruit pour
  l'analyse FAQ.
- La question loggée est la `query` reçue par la route ; le `userId` est celui
  de la session.

## 4. Feedback

### Mutation tRPC `brain.feedback`

Router `src/server/trpc/routers/brain.ts` (existant), `protectedProcedure` :

- Input zod : `{ messageId: string min(1), feedback: enum['like','dislike'] }`.
- `UPDATE chat_queries SET feedback WHERE messageId = ? AND userId = ctx.user.id`
  → `NOT_FOUND` si aucune ligne (message inconnu **ou** appartenant à un autre
  utilisateur — pas de feedback sur les messages d'autrui).
- Relais Dify **best-effort** : `POST {base}/v1/messages/{messageId}/feedbacks`
  avec `{ rating: feedback, user: ctx.user.id }`, header Bearer (helper dans
  `src/server/dify/client.ts`, même normalisation d'URL que `streamChat`).
  Échec Dify → loggé serveur, la mutation **réussit quand même** (le feedback
  local est la source de vérité pour la vue FAQ-gaps).

### UI — `useBrainChat` + `BrainChat`

- `useBrainChat` capture `messageId` au `message_end` et le pose sur le
  `BrainMessage` ai.
- Sous chaque réponse IA terminée (qui a un `messageId`) : boutons 👍/👎
  discrets (icônes, style `text-faint`, actif en `red`). Clic → mutation ;
  re-clic sur l'autre bouton → écrase (UPDATE). État visuel conservé pendant
  la session (pas re-hydraté au reload — YAGNI).

## 5. Vue admin `/admin/faq-gaps`

- Query `adminProcedure` `admin.faqGaps.list` : fenêtre 30 jours,
  `hasRelevantSource = false OR feedback = 'dislike'`.
- **Regroupement** par question normalisée — fonction pure
  `normalizeQuestion()` dans `src/lib/admin/` : lowercase, trim, espaces
  multiples écrasés, ponctuation finale (`?!.…`) retirée, accents conservés.
- Par groupe : question exemplaire (occurrence la plus récente), `count`,
  dernière date, `retrievalScoreMax` max du groupe, `retrievalCount` de la
  dernière occurrence, feedbacks agrégés (nb de dislikes).
- Tri : `count` desc, puis dernière date desc.
- Export CSV via `src/lib/admin/csv-export.ts` (pattern existant).
- Page protégée par le layout admin existant + entrée nav admin.

## 6. Configuration & RGPD

- `.env.example` : ajouter `FAQ_RELEVANCE_THRESHOLD=0.5` (commenté).
- `docs/DEPLOY.md` : documenter la variable.
- **RGPD** : les questions sont du texte libre potentiellement personnel.
  Documenter (dans `docs/DEPLOY.md`, section « Données & purge ») la purge des
  `chat_queries` de plus de 12 mois — commande SQL fournie, **cron non
  implémenté dans ce sprint** (conforme aux consignes). Aucune autre donnée
  personnelle que `userId` (déjà présent en base) et le texte de la question.

## 7. Sécurité

- `DIFY_API_KEY` reste serveur-only (client Dify dans `src/server/dify/`,
  jamais importé côté client) — inchangé.
- Feedback : ownership vérifié (`userId` de la session).
- Vue FAQ-gaps : `adminProcedure` (admin only).

## 8. Tests (TDD)

- **parse** : `message_end` expose `messageId` + `scores` ; tolérance aux
  champs absents/malformés ; rétro-compat des champs existants.
- **route** (pattern `brain-route.test.ts` existant) : insert appelé avec les
  bons agrégats (count/max/bool seuil) ; pas d'insert si stream sans
  `message_end` ; échec de l'insert n'affecte ni le statut ni les octets
  relayés ; seuil env personnalisé respecté.
- **feedback** : update + ownership (`NOT_FOUND` sur message d'autrui) ;
  relais Dify appelé avec la bonne URL/payload ; échec du relais → mutation OK.
- **normalizeQuestion** : casse, espaces, ponctuation finale, accents.
- **regroupement** : agrégats corrects (count, dates, scores).
- **composant** : boutons 👍/👎 rendus seulement avec `messageId`, clic →
  mutation avec les bons args, état actif.

## Hors périmètre (explicite)

- Regroupement sémantique par embeddings.
- Cron de purge RGPD (documenté seulement).
- Ré-hydratation de l'état feedback au rechargement de la page.
- Dashboard de tendances/statistiques au-delà de la liste triée.
