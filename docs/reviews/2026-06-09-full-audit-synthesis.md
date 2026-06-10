# Audit complet formaps — 2026-06-09 (main 9155e95)

6 reviewers Opus parallèles (auth/sécurité, BRAIN/Dify, Labo d'embed, tRPC+DB, frontend, infra/tests).
**Bilan : 7 CRITICAL · 26 IMPORTANT · 30 MINOR** (après dédup : la formula injection CSV était remontée par 2 reviewers).

État général : architecture saine — RBAC complet, argon2id, sanitize-html strict, auto-heal Dify
fonctionnel, Dockerfile conforme aux gotchas connus, 321 tests verts. Les CRITICAL sont des trous
de robustesse, pas des failles d'intrusion.

---

## CRITICAL (7)

| # | Domaine | Finding | Fichier |
|---|---------|---------|---------|
| CR-1 | BRAIN | Aucun timeout sur les `fetch` vers Dify — un Dify pendu bloque le handler indéfiniment | `src/server/dify/client.ts:35,63` |
| CR-2 | BRAIN | Stream amont jamais annulé si le client se déconnecte (`request.signal` ignoré) → connexions Dify zombies + tokens LLM facturés | `src/app/api/brain/route.ts:194` |
| CR-3 | DB | `scripts/migrate.mjs` sans try/catch ni `finally sql.end()` — échec de migration = stacktrace brut, pool pendant | `scripts/migrate.mjs:13-15` |
| CR-4 | DB | Migrations au boot sans `pg_advisory_lock` — 2 containers qui bootent ensemble = duplicate_table → unhealthy → router Traefik invisible | `scripts/migrate.mjs` |
| CR-5 | Front | Aucun `error.tsx` / `not-found.tsx` / `loading.tsx` dans `src/app` — toute erreur tRPC RSC = écran Next.js générique pour le salarié | `src/app/(app)/page.tsx:13-18` |
| CR-6 | Front+Sécu | Export CSV sans échappement RFC 4180 ni guard formule (`=+-@`) — questions FAQ libres + emails importés cassent/injectent Excel (le follow-up accepté n'a jamais été traité) | `src/lib/admin/faq-gaps.ts:74-84`, `csv-export.ts:42-50` |
| CR-7 | Infra | **Aucune CI** — Dokploy auto-déploie main sans gate lint/tsc/tests | `.github/workflows/` absent |

## IMPORTANT (26) — par domaine

### Auth & sécurité (1 + CR-6 partagé)
- **A-1** Aucun rate-limiting/anti-bruteforce sur `/connexion` ni resetPassword + timing oracle d'énumération (`if (!user) return null` avant verify) — `src/server/auth.ts:65-90`.

### BRAIN / Dify (5)
- **B-1** Race persist/purge du conversation_id : capture sur frame `message` (UPDATE fire-and-forget) vs purge sur `event: error` ultérieur — l'id « né en erreur » peut être persisté malgré le self-heal. Fix : ne persister qu'au `message_end` — `route.ts:129-145`.
- **B-2** `flush()` FAQ-gaps n'exclut pas `errorSeen` → conversations en erreur loggées comme gaps — `route.ts:166-187`.
- **B-3** Aucune limite de taille sur `query` (serveur ET client) — `route.ts:29-32`.
- **B-4** INSERT chat_queries fire-and-forget dans flush(), tué possible à l'arrêt du container — `route.ts:185`.
- **B-5** `sendFeedback` sans timeout fait traîner la mutation 👍/👎 — `client.ts:61-74`.

### Labo d'embed (5)
- **E-1** Joint d'overlap = espace dur vs separator au merge — approximation non documentée — `chunker.ts:89`.
- **E-2** `configKey` déduplique sur le séparateur ÉCHAPPÉ (pas `normalizeSeparator`) → `"\n\n"` et `"\\n\\n"` = 2 configs « différentes », dédup contournée — `types.ts:48-59`.
- **E-3** Verdict OCR du tour 1 réutilisé sans hash/contrôle du fichier re-uploadé au refine → reco OCR fausse silencieuse si mauvais fichier — `pipeline.ts:92-96`.
- **E-4** Prompt injection via contenu PDF (borné par forced tool use, mais non délimité « contenu non fiable ») — `claude.ts:113-116`.
- **E-5** Chunking sur `fullText` intégral non borné (×6 configs) — DoS CPU/mémoire sur PDF texte massif — `pipeline.ts:84,168`.

### tRPC + DB (5)
- **D-1** Email non lowercasé dans `userCreateSchema`/`userUpdateSchema` (le CSV le fait) → doublons par casse + login cassé — `schemas.ts:52`.
- **D-2** Import CSV : N inserts séquentiels + N hash argon2 (~minutes pour 2000 users) sur pool `max:1` → toute l'app bloquée — `admin.ts:260-301`.
- **D-3** Purge RGPD chat_queries 12 mois : documentée, jamais implémentée. Reco : route `POST /api/cron/purge-chat-queries` + `CRON_SECRET` + cron système.
- **D-4** `chat_queries.feedback` = text libre sans CHECK/enum — `schema.ts:94`.
- **D-5** Timestamps sans timezone partout (`timestamp` vs `timestamptz`) — bornes 30j/RGPD et `passwordChangedAt` sensibles au tz serveur — `schema.ts`.

### Frontend (6)
- **F-1** Classes mortes `bg-redSoft`/`border-redSoft` (theme = `redsoft` minuscule, Tailwind 4) → badge « Nouveau » sans fond, boutons Supprimer sans style — `FormationDocumentsAdmin.tsx:111,136`, `FormationsAdmin.tsx:174`.
- **F-2** Tiptap : navigation sans garde quand `saved===false` → perte d'article complet — `NewsEditor.tsx`.
- **F-3** Import CSV : aucune limite taille/lignes avant `bulk.mutate`, erreurs papaparse uniformes, mots de passe perdus au refresh sans avertissement — `CsvImportCard.tsx:128-147`.
- **F-4** `/actualites` inaccessible en mobile (absent du MobileTabBar, cloche décorative) — `MobileTabBar.tsx:8-14`.
- **F-5** Labels admin non associés (`htmlFor`/`id` absents — ChangePasswordForm le fait bien) — NewsEditor, UtilisateursAdmin, FormationsAdmin.
- **F-6** Toolbar Tiptap inaccessible (pas de `role="toolbar"`, `aria-pressed`, lien via `window.prompt`) — `TiptapEditor.tsx:78-153`.

### Infra (4)
- **I-1** Aucun header de sécurité HTTP (CSP, X-Frame-Options, nosniff, HSTS) — `next.config.ts`.
- **I-2** Pas de script `typecheck` (tsc des tests jamais gaté) — `package.json`.
- **I-3** Seul gate qualité = build Docker au déploiement Dokploy (corollaire de CR-7).
- **I-4** `migrate.mjs` sans retry si DB pas prête (drop transitoire = boot loop) — à fusionner avec CR-3/CR-4.

## MINOR (30) — sélection notable
- Bootstrap admin : `do update` ne bump pas `password_changed_at` → rotation par env n'invalide pas les JWT (`bootstrap-admin.mjs:27-34`).
- `UPLOADS_DIR` absent de `.env.example` et du tableau DEPLOY.md.
- Pool postgres `max:1` en prod (sérialise toute l'app) — `db/index.ts:16`.
- Stream tronqué sans message_end → bulle vide silencieuse côté client (`useBrainChat.ts:159-175`).
- Abort client embed-test n'annule pas les appels Claude (facturation continue).
- zod sans `.max()` sur contentHtml/query/name/title…
- `markDone` avec formationId inexistant → 500 au lieu de NOT_FOUND.
- UI morte : « Mot de passe oublié ? » inerte, icônes search/bell décoratives, lien SharePoint fantôme.
- Pending global non discriminé par ligne (NewsAdmin, SuggestionsAdmin).
- clipboard sans fallback (« Copié ✓ » menteur), Icon → null sans repli, admin non responsive.
- Tests server/routes sous jsdom par défaut (177s d'environnement vs 15s de tests).
- `engines >=20` vs .nvmrc/Docker 24 ; détails dans les rapports par domaine.

## Points sains confirmés
RBAC exhaustif (0 publicProcedure), pas de path traversal uploads (UUID + lookup DB), XSS news
neutralisé write-side, XSS markdown BRAIN neutralisé (react-markdown sans rehype-raw), secrets
hors git, plaintexts jamais loggés, boucle redirect Edge/Node toujours résolue, Dockerfile
(non-root, HOSTNAME=0.0.0.0, healthcheck 127.0.0.1), compose Traefik cohérent, seed fail-closed,
J-N calculé serveur UTC (pas d'hydration mismatch), pipeline embed-test très défensif et testé.

## Roadmap proposée (7 PRs)

1. **PR robustesse BRAIN** (CR-1, CR-2, B-1→B-5) — la classe de bug qui a déjà causé 2 incidents prod.
2. **PR CI + typecheck** (CR-7, I-2, I-3) — gate lint+tsc+tests+build avant Dokploy.
3. **PR CSV partagé RFC 4180** (CR-6 + F-3) — helper d'échappement + guard formule + bornes import.
4. **PR boot/migrations** (CR-3, CR-4, I-4) — try/catch/finally + advisory lock + retry DB.
5. **PR frontend filet** (CR-5, F-1, F-2, F-4) — error/not-found/loading + redsoft + garde Tiptap + tab Actualités.
6. **PR sécurité** (A-1, I-1, D-3) — rate-limit connexion + headers HTTP + cron purge RGPD.
7. **PR embed-lab + DB polish** (E-2, E-3, E-5, D-1, D-4) — configKey normalisé, hash fichier refine, borne chunking, email lowercase, enum feedback.
