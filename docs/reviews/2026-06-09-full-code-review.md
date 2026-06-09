# Code review complet — 2026-06-09

Audit complet du projet sur main `9155e95` (Labo d'embed v2.1), réalisé par 6 reviewers
parallèles (Opus) sur 6 domaines : auth/sécurité, serveur tRPC/DB, BRAIN/Dify,
Labo d'embed, frontend/uploads, infra/config/tests.

**Verdict global : 0 CRITICAL · 19 IMPORTANT · 30 MINOR.**
Le socle est sain : authz tRPC complète (adminProcedure partout, ownership vérifié),
pas de XSS (sanitize-html strict + react-markdown sans rehype-raw), pas de path
traversal exploitable, invalidation JWT correcte (Edge/Node split respecté), migrations
additives cohérentes, suite verte (tsc propre hors 2 erreurs test connues, lint 0
warning, 321/321 tests, npm audit sans high/critical), leçons Docker/Dokploy toutes
appliquées (HOSTNAME, 127.0.0.1, dokploy-network, labels).

---

## IMPORTANT (19, dédupliqués)

### Sécurité / Auth

**A1 — Injection de formule CSV dans l'export faq-gaps** — `src/lib/admin/faq-gaps.ts:80`
`g.question` vient brut des questions BRAIN des salariés (cross-user → cible = l'admin
qui ouvre l'export dans Excel). Aucune neutralisation `=+-@`. Même dette défensive dans
`toCredentialsCsv`/`buildTemplateCsv` (`src/lib/admin/csv-export.ts:42`).
*Fix : helper partagé qui préfixe `'` toute cellule commençant par `= + - @ TAB CR`.*

**A2 — Aucun rate limiting sur le login** — `auth.ts` authorize
Tentatives illimitées sur `/api/auth/callback/credentials`. argon2id ne protège pas du
credential-stuffing online. *Fix : throttle IP+email avec backoff après N échecs.*

**A3 — Emails non normalisés** — `src/lib/admin/prepare-user.ts:31`, `auth.ts:73`
Pas de `toLowerCase()` à la création ni à l'authorize ; unicité case-sensitive →
`Camille@aps.fr` ≠ `camille@aps.fr`, login en échec silencieux si la casse diffère du
CSV importé. *Fix : `.trim().toLowerCase()` aux deux bouts + index unique `lower(email)`.*

### Serveur / DB

**D1 — Index FK manquants** — `src/server/db/schema.ts`
Seul `chat_queries` est indexé. Manquent : `formation_documents.formation_id` (chaque
page formation), `user_formation_progress.user_id` (chaque home), `news(status,
published_at)` (liste publique). *Fix : migration additive d'index.*

**D2 — Bulk import users : hash argon2 séquentiel, max 2000 lignes** — `admin.ts:281`
2000 × ~200 ms de hash dans la boucle = timeout proxy assuré → import cassé à
mi-course ET mots de passe en clair (réponse) perdus. *Fix : abaisser le max à ~200-300
et/ou concurrence bornée.*

**D3 — Bulk imports non transactionnels → credentials perdus sur crash** — `admin.ts:84,260`
Lié à D2 : état partiel sans la réponse qui porte les seuls plaintext. Le skip
unique-violation rend le ré-import possible mais les users déjà créés sont inutilisables.
*Fix : mode dry-run + commit, ou statut partiel reprenable.*

**D4 — Lockout : un admin peut se rétrograder / rétrograder le dernier admin** — `admin.ts:214`
`users.update` accepte `role: employee` sur soi-même ou le dernier admin → plus aucun
accès console. *Fix : refuser si dernier admin ou self-demote.*

### BRAIN / Dify

**B1 — Aucun timeout sur les fetch Dify** — `src/server/dify/client.ts:35,63`
Socket qui pend = handler Node + requête utilisateur bloqués sans borne.
**B2 — Déconnexion client non propagée** — `route.ts` : `request.signal` jamais lié au
fetch Dify → génération LLM brûlée pour rien après fermeture d'onglet.
*Fix commun B1+B2 : `signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])`
passé à `streamChat`, TimeoutError → 502 `dify_unavailable`.*

**B3 — Course persistance conversationId vs event error** — `route.ts:136`
L'id est persisté dès le premier delta `message` (fire-and-forget) ; si un `event: error`
suit, la purge `set(null)` n'est pas ordonnée face au `set(newId)` → id empoisonné
possible malgré le self-heal. *Fix : ne persister qu'au `message_end` (errorSeen connu).*

**B4 — Parsing SSE n'accepte que `data: ` avec espace exact** — `src/server/dify/parse.ts:127`
`data:{...}` (légal en SSE) serait ignoré → message_end raté → trou dans faq-gaps.
*Fix : `data:` + espace optionnel, concat des lignes data multiples.*

### Labo d'embed

**E1 — `nativeSample` OCR non borné** — `src/server/embed-test/pipeline.ts:101`
Contrairement au propose (MAX_ANALYSIS_CHARS=80k), l'appel vision concatène 5 pages
sans plafond. *Fix : `slice(0, MAX_ANALYSIS_CHARS)`.*

**E2 — `parentText` dupliqué par enfant dans le prompt juge** — `claude.ts:366`
Pire-cas 15 × parent 8000 tk ≈ 120k tokens input par appel juge × N configs.
*Fix : dédupliquer le parent partagé entre enfants consécutifs ou plafonner.*

**E3 — `max_tokens: 16000` non-streaming sans check `stop_reason`** — `claude.ts:54`
Tool_use tronqué à max_tokens = échec zod opaque ; 16k non-streaming flirte avec le
timeout SDK. *Fix : `max_tokens` 2000-4000 (sorties structurées courtes) + erreur
explicite si `stop_reason === 'max_tokens'`.*

**E4 — Ni `thinking` ni `effort` configurés** — `claude.ts:52`
Choix non acté : pour le juge calibré, `thinking: adaptive` améliorerait la qualité.
*Fix : décision consciente à documenter (on/off).*

### Frontend / Uploads

**F1 — Uploads admin via `fetch()` cassent sous Basic Auth Dokploy** —
`NewsEditor.tsx:71`, `FormationDocumentsAdmin.tsx:59`
Gotcha parc connu : fetch ne réémet pas les creds Basic Auth. *Fix ops : bypass `/api/*`
dans Traefik si Basic Auth est posé devant le site.*

**F2 — Faux bouton « Ouvrir sur SharePoint »** — `formations/[slug]/page.tsx:157`
Sans `sharepointUrl`, un `<div>` stylé comme le lien actif est rendu, non cliquable.
*Fix : masquer ou état désactivé explicite.*

**F3 — Validation MIME sur `file.type` déclaré** — routes upload documents + cover
Falsifiable ; impact limité (admin-only) mais magic bytes (`%PDF-`, signatures images)
plus robustes.

### Infra

**I1 — `.env.example` incomplet** — manquent `UPLOADS_DIR` (utilisée en prod, mappée
compose) + `ALLOW_DESTRUCTIVE_SEED`/`SEED_ADMIN_PASSWORD`/`SEED_CAMILLE_PASSWORD` (dev).

---

## MINOR (30, condensés par thème)

- **Validation UUID absente en tête des routes fichiers** (signalé par 3 reviewers) :
  `documents/[docId]/download` (un docId non-UUID → 500 Postgres brute au lieu de 404),
  `news/[id]/cover`. Défense en profondeur + UX erreur.
- **Auth** : `query` BRAIN non bornée en longueur ; politique mdp min 8 sans complexité ;
  aucun header sécurité applicatif (CSP/XFO/HSTS — vérifier couverture Traefik) ;
  `next-auth` beta flottant (`^5.0.0-beta.31`) à épingler.
- **DB/tRPC** : `docCount` éditable à la main (désync possible avec les documents réels) ;
  `news.setStatus` 2e update sans re-check NOT_FOUND ; pas de `onError`/masquage des
  messages d'erreurs Postgres re-throw.
- **BRAIN** : `endScores === null` jette le log même quand le signal faq-gap serait
  pertinent ; INSERT chat_queries → `onConflictDoNothing()` explicite ; feedback 👍/👎
  optimiste sans rollback sur erreur ; `hadConversationId` fragile au refactor ;
  `FAQ_RELEVANCE_THRESHOLD` invalide silencieux (valider au boot).
- **Embed** : tours de raffinement sans plafond (coût) ; buffer SSE client sans limite
  défensive ; prompt injection bénigne via contenu PDF (frontière à délimiter) ;
  asymétrie séparateur manuel vs Claude (vigilance, pas de bug) ; OCR réutilisé sans
  vérifier que le PDF du tour N+1 est le même (hash à envisager).
- **Frontend** : classes Tailwind cassées `bg-redSoft`/`border-redSoft` (token =
  `redsoft` minuscule → badge « Nouveau » et boutons « Supprimer » sans fond rouge,
  3 emplacements, fix 1 ligne ×3) ; labels non associés aux inputs (a11y, formulaires
  admin) ; lien PDF employé sans `target/rel` (incohérent avec admin) ; `span` sanitisé
  sans `style` (piège si couleur Tiptap ajoutée).
- **Infra** : DEPLOY.md CMD obsolète (manque `bootstrap-admin.mjs`) ; `engines >=20` vs
  parc node 24 ; postcss MODERATE transitif via next (non actionnable, à suivre) ;
  `ANTHROPIC_API_KEY` absente du tableau §2 DEPLOY.md ; `migrate.mjs` chemin `./drizzle`
  relatif au cwd ; pas de CI GitHub (pas de gate sur les merges).

---

## Roadmap de remédiation proposée

1. **Sprint quick-wins** (~½ journée) : A1 (helper CSV partagé), A3 (normalisation
   email), D1 (migration index), D4 (garde dernier admin), F2 (bouton SharePoint),
   M-redSoft, I1 (.env.example), DEPLOY.md.
2. **Sprint cycle de vie BRAIN** : B1+B2 (AbortSignal.any), B3 (persist au message_end),
   B4 (parsing data:), + minors BRAIN associés.
3. **Sprint robustesse imports & embed** : D2+D3 (cap bulk + credentials), E1+E3
   (bornes + stop_reason), E2, F3 (magic bytes).
4. **Backlog** : A2 (rate limiting), headers sécurité, le reste des MINOR.
