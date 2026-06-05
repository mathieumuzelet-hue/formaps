# Auth — Invalidation des sessions JWT après changement/reset de mot de passe

**Date** : 2026-06-05
**Statut** : spec validée (brainstorming), en attente de plan d'implémentation
**Origine** : follow-up accepté du Sprint Phase 2 (JWT non invalidé après changement/reset
de mot de passe) + tests serveur manquants sur `changePassword`/`resetPassword`.

## Problème

Formaps utilise Auth.js v5 en stratégie **JWT pur** (pas de session DB) : un token signé
reste valable jusqu'à expiration, même après que le mot de passe du compte a été changé
(par l'utilisateur) ou réinitialisé (par un admin). Un token volé/d'un ancien appareil
survit donc au changement de mot de passe — c'est précisément le moment où l'on veut
tuer les sessions.

## Approche retenue (A — validée)

Comparaison **par égalité exacte** entre un claim `passwordChangedAt` (epoch ms) embarqué
dans le token à la connexion et la valeur en base, vérifiée dans le callback `jwt`
**Node-side** (`auth.ts`) à chaque lecture de session. Mismatch → `return null` →
Auth.js invalide la session → les **10 call sites** `auth()` (contexte tRPC, `/api/brain`,
downloads, covers news, layouts, pages) voient `session = null`.

Approches rejetées : vérification dans `protectedProcedure` seul (trou : routes API
non-tRPC) ; comparaison `token.iat` (flooré à la seconde → edge cases re-login) ;
helper wrappant les 10 call sites (oubliable sur les futurs endpoints).

## 1. Schéma

- `users.passwordChangedAt` : `timestamp NOT NULL DEFAULT now()` (Drizzle
  `timestamp('password_changed_at').defaultNow().notNull()`).
- Migration drizzle-kit additive, appliquée au boot (convention repo). Les users
  existants reçoivent la date de la migration.

## 2. Claim dans le token

- `authorize()` (`src/server/auth.ts`) retourne en plus
  `passwordChangedAt: user.passwordChangedAt.getTime()` (epoch ms).
- Le callback `jwt` **partagé** (`src/server/auth.config.ts`) copie ce champ sur le
  token au sign-in (quand `user` est présent), comme `role`/`storeId`/`firstName`.
  Ce callback reste edge-safe (pure copie, pas de DB).
- `src/types/next-auth.d.ts` : `passwordChangedAt: number` ajouté aux interfaces
  `User` et `JWT` (PAS à `Session.user` — le client n'en a pas besoin).

## 3. Vérification Node-side

Nouveau module testable **`src/server/auth/token-validation.ts`** :

- `isTokenStale(tokenValue: number | undefined, dbValue: Date | null): boolean` — pure :
  - `tokenValue` absent/undefined → **stale** (tokens émis avant ce déploiement :
    tout APS se reconnecte une fois au premier deploy — assumé) ;
  - `dbValue` null (user introuvable/supprimé) → **stale** ;
  - sinon stale ⇔ `tokenValue !== dbValue.getTime()` (égalité exacte).
- `validatePasswordFreshness(token, db): Promise<'fresh' | 'stale'>` —
  SELECT `passwordChangedAt` FROM users WHERE id = `token.sub` puis `isTokenStale`.
  - **Erreur DB → `'fresh'` (fail-open)** + `console.error` : une panne Postgres
    transitoire ne déconnecte pas tout le monde. Trade-off explicite et assumé
    (portail interne ; cohérent avec les patterns non-fatals du repo).

`src/server/auth.ts` surcharge le callback `jwt` (Node only — le middleware Edge
importe `auth.config.ts` et n'est pas affecté) :

```
jwt: async ({ token, user }) => {
  // Sign-in : délègue au callback partagé (stash des claims, dont passwordChangedAt).
  if (user) return authConfig.callbacks.jwt({ token, user })
  // Lectures suivantes : token tué si le mot de passe a changé depuis l'émission.
  if ((await validatePasswordFreshness(token, db)) === 'stale') return null
  return token
}
```

`return null` dans le callback `jwt` est le mécanisme documenté Auth.js v5 pour
invalider une session. **Risque identifié** : comportement à verrouiller par un test
d'intégration qui exerce le vrai NextAuth (voir §6) — si le comportement ne tient pas,
le fallback est de faire la même vérification dans le callback `session` en retournant
un objet session vidé, mais on ne l'implémente pas préventivement.

Coût : +1 SELECT par appel `auth()` (plusieurs par requête : layout + page + tRPC).
Négligeable à l'échelle d'APS. Pas de memoïzation v1 (YAGNI) ; follow-up possible
`React.cache()` si les latences le justifient.

## 4. Chemins d'écriture

`passwordChangedAt: new Date()` ajouté au `.set({...})` de :

1. `account.changePassword` (`src/server/trpc/routers/account.ts`) ;
2. `admin.users.update` (`src/server/trpc/routers/admin.ts`) — **seulement** quand
   `password` est fourni (un update de prénom/magasin ne doit PAS tuer les sessions) ;
3. `admin.users.resetPassword` (`src/server/trpc/routers/admin.ts`).

## 5. UX self-change

Le changement de son propre mot de passe invalide AUSSI la session courante (JWT pur :
pas de distinction par session). Décision validée : **déconnexion + re-login**.

- Après mutation `changePassword` réussie : le formulaire (`ChangePasswordForm`)
  appelle `signOut({ redirectTo: '/connexion?changed=1' })` (au lieu du message de
  succès en place actuel).
- Page `/connexion` : quand `?changed=1`, afficher « Mot de passe modifié,
  reconnectez-vous. » au-dessus du formulaire.
- Reset par admin : pas d'UX dédiée — les sessions de l'utilisateur meurent à leur
  prochaine lecture (redirect /connexion par le layout), comportement voulu.

## 6. Tests (TDD)

- **`isTokenStale`** (pur) : claim absent → stale ; dbValue null → stale ; égalité →
  fresh ; différence (avant/après) → stale.
- **`validatePasswordFreshness`** (db mockée) : fresh ; stale ; user introuvable →
  stale ; SELECT rejette → fresh (fail-open) + erreur loggée.
- **Tests serveur Phase 2 manquants** (caller tRPC, pattern `brain-feedback.test.ts`) :
  - `changePassword` : mauvais mot de passe actuel → UNAUTHORIZED sans write ;
    succès → `passwordHash` re-hashé (argon2) + `passwordChangedAt` posé ;
  - `resetPassword` : NOT_FOUND si user inconnu ; succès → plaintext retourné
    une fois + hash stocké + `passwordChangedAt` posé ;
  - `users.update` : avec `password` → `passwordChangedAt` posé ; sans `password` →
    PAS touché.
- **Intégration callback `jwt`** : sign-in stash le claim ; lecture fresh → token
  rendu ; lecture stale → null. Exercé contre le vrai objet NextAuth dans la mesure
  du faisable en vitest (au minimum : le callback exporté de auth.ts appelé
  directement avec db mockée).
- **Composant** : `ChangePasswordForm` appelle signOut après succès ; page connexion
  affiche le message quand `?changed=1`.

## 7. Sécurité & limites

- La fenêtre de validité d'un token volé se réduit à « jusqu'au prochain changement
  de mot de passe » — c'est l'objectif.
- Fail-open sur erreur DB : un attaquant ne peut pas le provoquer à distance
  (la DB est interne au réseau Docker) ; assumé.
- Le middleware Edge ne vérifie PAS la fraîcheur (pas de DB sur Edge) : il gate la
  navigation par présence de cookie, mais tout rendu de page/donnée passe par un
  `auth()` Node qui, lui, vérifie. Aucune donnée n'est servie sur un token périmé.

## Hors périmètre (explicite)

- Invalidation sélective par session/appareil (impossible en JWT pur sans store).
- Bouton « se déconnecter partout » manuel.
- Rate limiting sur changePassword/login.
- Memoïzation du SELECT de fraîcheur (`React.cache()`) — follow-up si besoin.
- Invalidation à la suppression de compte au-delà de l'effet naturel
  (user introuvable → stale, déjà couvert).
