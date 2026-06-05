# Sprint Phase 2 — Reset mot de passe, markDone UI, suggestions BRAIN

**Date :** 2026-06-05
**Statut :** Approuvé (brainstorming 2026-06-05)

## Contexte

V1 + post-V1 livrés en prod (main, auto-déploiement Dokploy). Trois chantiers Phase 2
identifiés à la livraison V1 :

1. Reset mot de passe (aucun flux aujourd'hui hors édition admin manuelle).
2. `progress.markDone` existe côté API mais aucun bouton UI ne l'appelle.
3. Les suggestions BRAIN sont hardcodées dans `src/lib/brain/suggestions.ts`.

Contraintes structurantes relevées à l'exploration :

- **Aucune stack email** dans le projet (pas de SMTP/Resend/nodemailer) → le reset
  « par email » est exclu de ce sprint.
- Le pattern « mot de passe généré + montré une fois » existe déjà
  (`src/server/auth/generate-password.ts`, utilisé par `admin.users.bulkCreate`).
- Toutes les pages `(app)` sont des Server Components alimentés par
  `getServerCaller()` ; les mutations client n'existent que dans `src/components/admin/*`.

## Lot 1 — Reset mot de passe par admin + changement self-service

### 1a. Reset par admin

- Nouvelle mutation `admin.users.resetPassword` (input `{ id: uuid }`, `adminProcedure`)
  dans `src/server/trpc/routers/admin.ts` :
  `generatePassword(12)` → `hashPassword` → update `users.passwordHash` →
  retourne `{ id, email, password }` (plaintext, montré une seule fois).
  `NOT_FOUND` si l'utilisateur n'existe pas.
- UI : bouton « Réinitialiser le mdp » par ligne dans `UtilisateursAdmin.tsx`,
  avec confirmation. En succès, encart copiable affichant le mot de passe généré
  (même UX que les credentials de l'import CSV). L'encart disparaît à la fermeture —
  pas de persistance du plaintext.

### 1b. Changement self-service

- Nouveau router `account` (`src/server/trpc/routers/account.ts`), mutation
  `changePassword` (`protectedProcedure`), input
  `{ currentPassword: string, newPassword: string (min 8) }` :
  `verifyPassword(hash, currentPassword)` → sinon `UNAUTHORIZED` →
  `hashPassword(newPassword)` → update. Ne retourne jamais de hash.
- Schemas zod dans `src/lib/admin/schemas.ts` ou module dédié server-free
  (testable sans tRPC).
- UI : page `/compte/mot-de-passe` (Server Component fin + client component
  `ChangePasswordForm`) — champ ancien mdp, nouveau ×2 (validation égalité côté
  client), feedback succès/erreur. Accès : l'avatar initiales de `BNav.tsx`
  (aujourd'hui non interactif) devient un lien vers `/compte/mot-de-passe`.

## Lot 2 — Bouton « Marquer comme terminée » (annulable)

- Nouvelle mutation `progress.markUndone` (input `{ formationId: uuid }`,
  `protectedProcedure`) : supprime la ligne `userFormationProgress`
  `(userId, formationId)` → retour à l'état `not_started`. Idempotente
  (pas d'erreur si la ligne n'existe pas).
- Client component `MarkDoneButton` (`src/components/formation/MarkDoneButton.tsx`),
  props `{ formationId, percent }` :
  - `percent < 100` → bouton « Marquer comme terminée » → `progress.markDone`.
  - `percent === 100` → badge ✓ « Terminée » + lien discret
    « Marquer comme non terminée » → `progress.markUndone`.
  - `onSuccess` → `router.refresh()` (les données viennent du RSC), bouton
    désactivé pendant la mutation.
- Intégration dans la carte PROGRESSION de `src/app/(app)/formations/[slug]/page.tsx`.
- La BRoute (étape du **magasin**) n'est pas touchée — sémantique distincte.

## Lot 3 — Suggestions BRAIN en base (+ fallback)

- Table `brain_suggestions` dans `src/server/db/schema.ts` :
  `id` uuid PK, `text` text notNull, `sortOrder` int notNull default 0,
  `isActive` boolean notNull default true, `createdAt`/`updatedAt`.
  Migration via `npm run db:generate`.
- Sub-router `admin.brainSuggestions` (pattern stores/news) :
  `list` / `create` / `update` / `delete` / `reorder`, erreurs `NOT_FOUND`.
  Zod dans `src/lib/admin/schemas.ts` (`text` min 1 max 200).
- Lecture employé : la page `src/app/(app)/brain/page.tsx` (RSC) appelle une query
  `brain.suggestions` (`protectedProcedure`, suggestions actives triées par
  `sortOrder`) et passe le tableau **en props** à `BrainChat`.
- **Fallback** : si aucune suggestion active en base, `BrainChat` affiche les 4
  questions hardcodées (`BRAIN_SUGGESTIONS` conservé comme constante de fallback) —
  la zone suggestions n'est jamais vide.
- Admin UI : `SuggestionsAdmin.tsx` (liste + create/edit inline + toggle actif +
  réordonnancement ↑/↓), page `src/app/admin/suggestions/page.tsx`, lien dans
  `AdminNav.tsx`.

## Hors périmètre (explicitement)

- Reset par email / table de tokens / lien à usage unique.
- Suggestions BRAIN contextuelles par étape BRoute.
- Action markDone sur les cartes « À reprendre » de l'accueil.

## Tests & qualité

- TDD avec Vitest (runner existant, 31 fichiers / ~116 cas). Logique extraite en
  modules purs server-free comme l'existant (`schemas`, helpers).
- Couverture attendue : schemas zod reset/changePassword, helper fallback
  suggestions, `MarkDoneButton` (Testing Library), mutations (logique extraite).
- Lint + `tsc --noEmit` + suite complète verte avant chaque commit.
- Ordre d'exécution : **Lot 2 → Lot 3 → Lot 1** (du plus petit au plus gros).

## Critères de succès

1. Un admin peut réinitialiser le mdp d'un user et lui transmettre le nouveau.
2. Un employé connecté peut changer son propre mot de passe.
3. Un employé peut marquer une formation terminée / annuler depuis la page détail.
4. L'admin pilote les suggestions BRAIN ; le chat ne montre jamais une zone vide.
5. Aucune régression : suite de tests complète verte, lint propre.
