# Formation Cover Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou executing-plans.

**Goal:** L'admin peut uploader le visuel de couverture d'une formation (paramétrage), affiché sur la page détail à la place du placeholder `ImgSlot` « visuel de couverture (photo caisse / capture) ».

**Architecture:** Réplique 1:1 du pattern news cover (éprouvé en prod) : colonne `coverImageUrl` nullable sur `formations` (migration 0006 additive via `npm run db:generate`), upload admin `POST /api/admin/formations/[id]/cover` (fichier `${UPLOADS_DIR}/formations/<id>.<ext>`, purge `<id>.*` avant écriture, allowlist png/jpeg/webp/gif, 5 Mo, 403/404/400/415/413/500), service `GET /api/formations/[id]/cover` (authentifié, `Cache-Control: private, max-age=60`). Les DEUX routes se copient de `src/app/api/admin/news/[id]/cover/route.ts` et `src/app/api/news/[id]/cover/route.ts` en remplaçant news→formations (table, dir, URL). NOTE : `formations` n'a PAS de colonne `updatedAt` — le POST ne set QUE `coverImageUrl: '/api/formations/<id>/cover'` ; le cache-bust de la preview admin utilise un state local (`Date.now()` après upload réussi).

### Task 1: Colonne + migration + routes (TDD)
- `schema.ts` : `coverImageUrl: text('cover_image_url')` sur formations. `npm run db:generate -- --name=formation_cover` → vérifier SQL = un seul ALTER TABLE ADD COLUMN.
- Les 2 routes (copies adaptées). Tests : nouveau `tests/server/formation-cover-route.test.ts` calqué sur `tests/server/news-cover-route.test.ts` (LIRE ce fichier et reprendre ses mocks) : 403 non-admin, 404 formation inconnue, 415 mauvais type, 413 trop lourd, 201 + update coverImageUrl ; GET : 401 anonyme, 404 sans fichier, 200 avec Content-Type.
- Commit `feat(formations): cover image upload and serving routes`

### Task 2: UI admin (TDD)
- Nouveau `src/components/admin/FormationCoverAdmin.tsx` (client) : bloc « Visuel de couverture » calqué sur le bloc cover de `NewsEditor.tsx` (preview `<img>` si coverImageUrl — avec `?v=` state local post-upload —, input file image/*, messages d'erreur FR via le même mapping 413/415, état « Envoi en cours… », label htmlFor/id `formation-cover`). Source de la valeur courante : query `trpc.admin.formations.list` filtrée par id si elle existe, SINON ajouter `admin.formations.byId` (adminProcedure, z.uuid) — choisir le plus simple en lisant `src/server/trpc/routers/admin.ts`. Invalidate la query après upload.
- Monter le composant dans `src/app/admin/formations/[id]/page.tsx` AU-DESSUS de `FormationDocumentsAdmin`.
- Test composant `tests/components/FormationCoverAdmin.test.tsx` (mock trpc + fetch, pattern NewsEditor/FaqGapsAdmin) : preview affichée si URL, message d'erreur sur 413, upload réussi → fetch POST appelé sur la bonne URL.
- Commit `feat(admin): formation cover upload UI`

### Task 3: Affichage page détail
- `src/app/(app)/formations/[slug]/page.tsx` colonne droite : si `formation.coverImageUrl`, rendre `<img src={formation.coverImageUrl} alt="" className="h-[170px] w-full rounded-[16px] border border-line object-cover" />` (avec `// eslint-disable-next-line @next/next/no-img-element` comme NewsEditor) ; sinon l'`ImgSlot` actuel inchangé. `formation.bySlug` fait déjà `select()` complet → la colonne arrive seule.
- Commit `feat(formations): show the cover image on the detail page`

### Task 4: Vérifs
- `npm test` complet (compte exact), lint, tsc (2 erreurs préexistantes admises). `docker compose config -q` inutile (pas de changement compose).
- Hors scope assumé : FormationCard (grille) garde son icône ; pas de suppression de couverture (re-upload remplace) — comme news.
