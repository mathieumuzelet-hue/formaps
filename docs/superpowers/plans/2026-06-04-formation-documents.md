# Documents PDF des formations + slug auto — Plan

> Sous-projet d'extension du Cockpit. Stack en place : Next.js 16, tRPC v11, Drizzle/Postgres, Auth.js v5, Tailwind 4. Déploiement Dokploy/Traefik (conteneur web non-root `nextjs`, volume Postgres persistant).

**Goal :** permettre à un bloc formation `kind=pdf` d'héberger plusieurs fichiers PDF **uploadés** (stockés sur un volume persistant), gérés depuis l'admin ; + génération automatique du slug.

**Décisions (validées) :** upload de vrais fichiers (pas liens) ; stockage = volume disque persistant `cockpit_uploads` monté `/app/uploads` ; bloc SharePoint **XOR** pdf (inchangé) ; pages saisies manuellement ; taille calculée auto ; pas de preview.

## Modèle (existant, inchangé)
`formation_documents` : `id` uuid, `formationId`, `title`, `pages` int, `sizeLabel` text, `fileUrl` text, `isNew` bool, `order` int. Fichier disque = `/app/uploads/<docId>.pdf`. `fileUrl = /api/documents/<docId>/download`.

## Lot 1 — Backend & infra

- **`src/lib/slug.ts`** : `slugify(name)` pur (minuscules, NFD strip accents, non-alphanum→`-`, collapse/trim). TDD : « Relation client »→`relation-client`, « RH & Paie »→`rh-paie`, « Sécurité & Hygiène »→`securite-hygiene`.
- **`src/lib/format-size.ts`** : `formatFileSize(bytes)` → « 2,4 Mo » / « 850 Ko » (décimale virgule FR). TDD.
- **Compose** : volume nommé `cockpit_uploads:/app/uploads` sur le service `web`.
- **Dockerfile** : `RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads` AVANT `USER nextjs` (le 1er montage du volume hérite de cette propriété → écriture par uid 1001).
- **Upload route** `src/app/api/admin/formations/[id]/documents/route.ts` (`runtime nodejs`, `POST`) : `auth()` + rôle admin sinon 403 ; lit `request.formData()` ; valide `file` présent, `type === 'application/pdf'`, taille ≤ 25 Mo (sinon 413) ; INSERT document (title du form ou nom de fichier, pages saisies, isNew) returning id ; écrit le PDF en `/app/uploads/<id>.pdf` ; UPDATE `fileUrl=/api/documents/<id>/download`, `sizeLabel=formatFileSize(taille)`, `order`=max+1. Renvoie le doc créé. Erreurs → JSON + status.
- **Download route** `src/app/api/documents/[docId]/download/route.ts` (`runtime nodejs`, `GET`) : `auth()` sinon 401 ; charge le doc ; si fichier absent → 404 ; streame `/app/uploads/<docId>.pdf` avec `Content-Type: application/pdf` + `Content-Disposition: inline; filename=...`.
- **tRPC admin** (`admin.ts`, `formations` sous-routeur) : `documentsByFormation({ formationId })` (list, ordre `order`) ; `deleteDocument({ docId })` (supprime la ligne ET `fs.rm('/app/uploads/<docId>.pdf', {force:true})`).
- **Tests** : slugify, formatFileSize (TDD pur). Upload route : test 401/403 non-admin (mock auth). Le reste validé par build/typecheck.

## Lot 2 — Admin UI & slug auto

- **Auto-slug** dans `MagasinsAdmin`… non : dans le **formulaire de création de formation** (`FormationsAdmin`) : à la frappe du nom, remplir le slug via `slugify(name)` tant que l'utilisateur n'a pas édité le slug manuellement (flag `slugTouched`). Champ slug reste éditable.
- **Lien « Gérer les documents »** sur chaque carte/ligne `kind=pdf` de l'admin formations → `/admin/formations/[id]`.
- **Page** `src/app/admin/formations/[id]/page.tsx` (server shell, garde admin via layout) + composant client `FormationDocumentsAdmin` : affiche le bloc, liste les documents (`admin.formations.documentsByFormation`), formulaire d'upload (`<input type=file accept=application/pdf>` + titre + pages + checkbox Nouveau) qui `POST` vers `/api/admin/formations/[id]/documents` (fetch multipart), refresh la liste au succès, erreurs inline, bouton supprimer (confirm) → `deleteDocument` + invalidate. Bouton retour vers `/admin/formations`.
- **Tests** : composant rendu (mock), + helper éventuel. Build/lint/test verts.

## Vérif déploiement
Volume `cockpit_uploads` créé ; uploads persistent après redeploy ; download auth-gated OK. Cap 25 Mo. Pdf seulement.
