# Spec — PR ⑥ Sécurité (durcissement applicatif)

**Date** : 2026-06-11
**Origine** : audit complet 2026-06-09 (`docs/reviews/2026-06-09-full-code-review.md` +
`docs/reviews/2026-06-09-fable5-audit.md`), PR ⑥ de la roadmap consolidée 7 PRs.
**Décisions utilisateur** : session JWT **7 jours** ; headers HTTP **set sûr sans CSP**.

## Objectif

Fermer les findings sécurité IMPORTANT/consensus des audits : rate-limit login + timing
oracle, normalisation email, claims JWT figés, garde dernier admin, errorFormatter tRPC,
purge RGPD automatisée, headers HTTP, et durcissements divers (max mot de passe,
sharepointUrl, UNIQUE stores.name, Cache-Control downloads). Aucune nouvelle feature
visible employé ; impact admin minimal (messages d'erreur génériques sur les 500).

## 1. Rate-limit login + suppression du timing oracle

**Fichiers** : nouveau `src/server/auth/rate-limit.ts` + branchement dans
`src/server/auth.ts` (authorize).

- Limiteur **en mémoire** (mono-container Dokploy assumé ; le compteur se réinitialise au
  redéploiement — limitation documentée dans le module).
- Clé : `${ip}|${email normalisé}`. IP extraite de `x-forwarded-for` (premier élément,
  posé par Traefik) avec repli `'unknown'`.
- Politique : **5 échecs / fenêtre glissante 15 min** → `authorize` retourne `null`
  immédiatement (sans requête DB ni argon2). Un login réussi purge l'entrée.
- Implémentation : `Map<string, number[]>` (timestamps des échecs), élagage des entrées
  expirées à chaque accès + sweep périodique (éviter la croissance non bornée).
- API du module : `isRateLimited(key): boolean`, `recordFailure(key)`,
  `clearFailures(key)` + constantes exportées pour les tests (injection d'horloge
  `now()` paramétrable).
- **Timing oracle** : quand l'email n'existe pas en base, exécuter quand même
  `verifyPassword(DUMMY_HASH, password)` sur un hash argon2id factice constant avant de
  retourner `null` — le temps de réponse ne distingue plus « email inconnu » de
  « mot de passe faux ».
- Au passage dans authorize : remplacer le `SELECT *` par une projection explicite
  (id, email, firstName, passwordHash, role, storeId, passwordChangedAt).

## 2. Normalisation email (trim + lowercase)

**Fichiers** : `src/server/auth.ts`, `src/lib/admin/prepare-user.ts`,
`src/server/trpc/routers/admin.ts` (users.update), migration `drizzle/0008_*.sql`,
`src/server/db/schema.ts`.

- Helper partagé `normalizeEmail(s) = s.trim().toLowerCase()` appliqué :
  à l'authorize (lookup), à la création (UI + import CSV via prepare-user),
  à users.update si email fourni.
- **Migration 0008** (additive) :
  1. `UPDATE users SET email = lower(trim(email))` ;
  2. index unique fonctionnel `users_email_lower_idx ON users (lower(email))`
     (défense en profondeur si un chemin d'écriture futur oublie la normalisation).
- Si la prod contient deux emails ne différant que par la casse, la migration échoue
  bruyamment au boot — voulu (résolution manuelle, cas jugé improbable).
- La contrainte `.unique()` existante sur `email` est conservée.

## 3. Claims JWT role/storeId rafraîchis à chaque requête

**Fichiers** : `src/server/auth/token-validation.ts`, `src/server/auth.ts`
(nodeJwtCallback), `src/server/auth.config.ts` (types/claims inchangés).

- Étendre la projection de `validatePasswordFreshness` à
  `{ passwordChangedAt, role, storeId }` (même SELECT, coût nul) ; renommer/adapter le
  retour pour porter les valeurs fraîches (ex. `{ status: 'fresh', role, storeId }`).
- `nodeJwtCallback` réécrit `token.role` et `token.storeId` avec les valeurs DB à chaque
  `auth()` : une rétrogradation ou un changement de magasin prend effet à la requête
  suivante, plus au re-login.
- **Fail-open inchangé** : erreur DB → `'fresh'` sans valeurs → claims existants
  conservés (et session non tuée), comportement actuel préservé.
- Le callback `session` (auth.config.ts) lit déjà role/storeId depuis le token — aucun
  changement edge.

## 4. Session maxAge 7 jours

**Fichier** : config partagée des deux instances NextAuth (auth.config.ts, repris par
auth.ts et middleware.ts).

- `session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 }`.
- ⚠️ Déploiement : les tokens existants gardent leur `exp` d'origine (≤30 j) ; seuls les
  nouveaux logins prennent 7 j. Pas de déconnexion massive.

## 5. Garde dernier admin (users.update)

**Fichier** : `src/server/trpc/routers/admin.ts` (~l.215).

- Si l'update passe `role: 'employee'` sur un utilisateur actuellement `admin` :
  - cible = soi-même (`ctx.user.id === id`) → `TRPCError FORBIDDEN`
    (message : impossible de se rétrograder soi-même) ;
  - cible = dernier admin (`count(*) FROM users WHERE role='admin'` ≤ 1) →
    `TRPCError FORBIDDEN` (message : il doit rester au moins un administrateur).
- Pas de transaction exigée (fenêtre de course admin↔admin jugée non-risque sur ce
  produit ; documenté en commentaire).

## 6. errorFormatter tRPC

**Fichier** : `src/server/trpc/trpc.ts`.

- `errorFormatter` dans `initTRPC.create()` : si `error.code === 'INTERNAL_SERVER_ERROR'`
  **et** que la cause n'est pas une `TRPCError` intentionnelle, remplacer
  `shape.message` par un message générique français (« Une erreur interne est
  survenue. ») ; logguer côté serveur le message original (console.error).
- Les erreurs métier (UNAUTHORIZED, FORBIDDEN, CONFLICT, BAD_REQUEST/zod) passent
  inchangées — l'UI admin s'appuie dessus.

## 7. Purge RGPD automatisée (chat_queries)

**Fichiers** : nouveau `src/instrumentation.ts` + nouveau
`src/server/jobs/purge-chat-queries.ts` ; `docker-compose.yml` (mapping env) ;
`docs/DEPLOY.md`.

- Hook Next.js `register()` (gardé `process.env.NEXT_RUNTIME === 'nodejs'`) : exécute la
  purge **au boot** puis via `setInterval` toutes les **24 h** (`unref()` pour ne pas
  retenir le process).
- Purge : `DELETE FROM chat_queries WHERE created_at < now() - interval 'N months'`
  (SQL paramétré Drizzle), `N` = env `CHAT_QUERIES_RETENTION_MONTHS` (défaut **12**,
  validation entier ≥1, valeur invalide → défaut + warn).
- Log à chaque run : nombre de lignes supprimées. Erreur DB → console.error, jamais de
  crash (le job réessaie au tick suivant).
- `CHAT_QUERIES_RETENTION_MONTHS` mappée dans `web.environment` du compose (leçon
  FAQ_RELEVANCE_THRESHOLD).
- DEPLOY.md : la section purge manuelle devient un filet (« automatisée depuis la PR ⑥,
  SQL manuel en secours »).

## 8. Headers HTTP

**Fichier** : `next.config.ts`.

- `poweredByHeader: false`.
- `headers()` → pour `/(.*)` :
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- **Pas de CSP** (acté : app interne authentifiée, HTML sanitisé par sanitize-html ;
  follow-up possible en Report-Only). HSTS laissé à Traefik.

## 9. Durcissements divers

- **Mots de passe `.max(128)`** : `credentialsSchema` (auth.ts),
  `userCreateSchema`/`userUpdateSchema` (`src/lib/admin/schemas.ts`),
  `src/lib/account/schemas.ts` (newPassword) — bloque l'argon2 sur entrée de plusieurs Mo.
- **`sharepointUrl`** : `z.string().url()` + `.refine(https?:)` (bloque `javascript:` —
  zod `.url()` ne filtre pas le scheme, vérifié par exécution à l'audit).
- **UNIQUE `stores.name`** : contrainte dans schema.ts + migration 0008 (même fichier que
  l'email). Rend vivant le handling 23505 existant de `stores.bulkCreate`. Même politique
  fail-loud si doublons en prod.
- **Download PDF** (`src/app/api/documents/[docId]/download/route.ts`) :
  `Cache-Control: private, no-store` + `X-Content-Type-Options: nosniff`.

## Hors scope (assumé)

CSP (même Report-Only) ; rate-limit distribué/Redis ; purge RGPD d'autres tables ;
transactionnalité/cap bulk import (PR ③) ; backup Postgres + advisory lock migrations
(PR ④) ; magic bytes uploads (PR ⑦ ou follow-up) ; contrastes WCAG.

## Tests (TDD par item)

- `rate-limit.test.ts` : sous le seuil OK, 5 échecs → bloqué, fenêtre expirée → débloqué,
  reset au succès, clés ip|email indépendantes, sweep.
- `auth.ts` (authorize) : email casse différente → login OK ; bloqué après 5 échecs ;
  dummy verify appelé quand email inconnu (spy).
- `token-validation.test.ts` : projection étendue, claims réécrits, fail-open conserve
  les claims.
- `admin-users` : self-demote refusé, dernier admin refusé, demote OK s'il reste un
  autre admin, update sans role inchangé.
- `trpc errorFormatter` : 500 interne → message générique ; CONFLICT/zod → intacts.
- `purge-chat-queries.test.ts` : borne N mois, défaut 12, env invalide → 12, erreur DB
  ne throw pas.
- Schémas : password >128 rejeté, `javascript:` rejeté, https accepté.
- next.config : headers présents (test de la fonction `headers()`).
- Migration 0008 : vérifiée au boot Docker local si Docker dispo, sinon au boot prod
  (politique habituelle du projet).

## Déploiement / risques

- Migration 0008 fail-loud si emails dupliqués par casse ou stores.name dupliqués —
  vérifier les logs Dokploy au déploiement ; remédiation = SQL manuel puis redeploy.
- Sessions existantes : non affectées (pas de bump passwordChangedAt).
- Nouveau env optionnel `CHAT_QUERIES_RETENTION_MONTHS` (défaut 12, rien à poser dans
  l'UI Dokploy sauf besoin client).
