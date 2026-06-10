# Auto Progress From Document Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** La progression d'une formation évolue automatiquement quand l'utilisateur consulte OU télécharge ses documents (les deux passent par `GET /api/documents/[docId]/download`). Le bouton « Marquer comme terminée » disparaît (il faussait le suivi).

**Architecture:** Nouvelle table `user_document_views` (PK composite user+document, INSERT fire-and-forget `onConflictDoNothing` dans la route download). `progress.mine` recalcule : % par formation = documents vus / documents totaux ; « terminée » = 100 % avec ≥ 1 document. L'ancienne table `user_formation_progress` reste en base (legacy, non lue — drop dans une migration future) ; les mutations markDone/markUndone et le composant MarkDoneButton sont supprimés. Un petit composant client `RefreshOnFocus` rafraîchit la page au retour de l'onglet PDF pour que la barre bouge sans F5.

**Décisions :** formation sans document (SharePoint only) = 0 %, jamais « terminée » (assumé, à revoir si on veut compter le clic SharePoint). Vue admin comptée comme vue (inoffensif). Migration via `npm run db:generate` (additive).

### Task 1: Schéma + migration + enregistrement des vues
- `src/server/db/schema.ts` : table `userDocumentViews` (userId FK cascade, documentId FK cascade, viewedAt defaultNow, `primaryKey({ columns: [userId, documentId] })`) ; commentaire « legacy » sur `userFormationProgress`.
- `npm run db:generate` → migration 0005 additive (vérifier le SQL généré : CREATE TABLE seul).
- Route download : après le lookup doc réussi, fire-and-forget `db.insert(userDocumentViews).values({ userId, documentId: docId }).onConflictDoNothing()` (jamais bloquer ni faire échouer le téléchargement). TDD dans `tests/server/download-route.test.ts`.

### Task 2: progress.mine recalculé + suppression markDone/markUndone
- `src/lib/progress.ts` : nouveau helper pur `summarizeDocProgress(totals: {formationId,total}[], viewed: {formationId,viewed}[], formationCount)` → `{ done, total, percentByFormation }` (percent = round(viewed/total×100) clampé 100 ; done = formations total>0 && viewed≥total ; total = formationCount). TDD `tests/lib/progress.test.ts` (remplacer les tests de l'ancien summarizeProgress si supprimé).
- `src/server/trpc/routers/progress.ts` : `mine` fait 3 requêtes (totaux par formation via groupBy sur formation_documents ; vus par formation via join user_document_views×formation_documents filtré userId groupBy ; count formations) → helper. SUPPRIMER markDone/markUndone.
- Supprimer les tests serveur de markDone/markUndone s'il y en a ; adapter ceux de mine.

### Task 3: UI
- Supprimer `src/components/formation/MarkDoneButton.tsx` + son test + son usage dans `formations/[slug]/page.tsx`.
- Dans la carte PROGRESSION : à la place du bouton — à 100 % : badge « ✓ Formation terminée » (check redink, style du badge existant de MarkDoneButton) ; sinon : note `« La progression avance automatiquement quand vous consultez les documents. »` (text-[12.5px] text-sub, bordure top comme l'ancien bloc).
- Nouveau `src/components/formation/RefreshOnFocus.tsx` (client) : `router.refresh()` sur l'event window focus, monté dans la page détail formation (return null). But : la barre se met à jour quand l'utilisateur revient de l'onglet PDF.

### Task 4: Vérifs + commits
- `npm test` complet, lint, tsc (2 erreurs préexistantes admises). Grep `markDone|MarkDoneButton|userFormationProgress` : seuls le schéma (legacy) et les migrations historiques peuvent rester.
- Commits séparés par task : `feat(progress): record document views on download/consult`, `feat(progress): compute formation progress from document views`, `feat(formations): automatic progression UI, drop manual done button`.
