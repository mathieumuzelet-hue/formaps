# Audit Fable 5 — 2026-06-09 (passes C et D, main 5e4b136)

Troisième ET quatrième audits indépendants du même code (9155e95 + docs), avec 6 subagents
**Fable 5** chacun (les deux premières passes étaient en Opus — voir
`2026-06-09-full-code-review.md` pour la réconciliation des passes A/B). Passe C :
**1 CRITICAL · 34 IMPORTANT · 56 MINOR**. Passe D (différentielle : les agents recevaient
les findings connus et ne cherchaient que du neuf + les faux positifs) : **1 CRITICAL
(le même FB-C1, trouvé indépendamment) + ~17 nouveaux IMPORTANT/MOYEN + ~35 MINOR**,
section dédiée en fin de document.

Calibration plus conservatrice que les passes Opus (ce qu'Opus classait CRITICAL —
timeout Dify, CI absente, migrate.mjs — est classé IMPORTANT ici, avec arguments).
L'essentiel : cette passe **confirme tous les findings majeurs déjà réconciliés** ET
remonte **un CRITICAL fonctionnel inédit** + une douzaine de findings nouveaux.

---

## 🆕 CRITICAL inédit — à reproduire en priorité

**FB-C1 — TiptapEditor ne charge jamais le contenu existant → « Enregistrer » peut détruire un article.**
`TiptapEditor.tsx:24-38` + `NewsEditor.tsx:32-40`. L'instance Tiptap est créée avec
`content: ''` (les effets enfant tournent avant l'hydratation du parent), et vérification
faite dans `@tiptap/core` : `setOptions` ne ré-applique **jamais** le document — `content`
est initial-only. Rouvrir une actualité existante → éditeur **vide** → Enregistrer envoie
`contentHtml` vide.
**Repro** : ouvrir `/admin/actualites/[id]` d'un article existant et regarder si l'éditeur
contient le HTML. **Fix** : effet de sync `editor.commands.setContent(value)` au premier
chargement, ou `key` qui remonte le composant une fois la query chargée.
*(Aucune des 2 passes Opus ne l'avait vu — et zéro test sur NewsEditor/TiptapEditor.)*

## 🆕 IMPORTANT inédits (absents des passes A/B)

1. **Claims JWT `role`/`storeId` jamais rafraîchis** (`auth.config.ts:30-38`) — un admin
   rétrogradé garde ses droits jusqu'au re-login ; un changement de magasin ne prend pas
   effet. Fix : recharger role/storeId dans `nodeJwtCallback` (même requête que
   passwordChangedAt, coût nul).
2. **`stores.name` sans contrainte UNIQUE** (`schema.ts:8-15`) — le handling 23505 de
   `stores.bulkCreate` est du code mort ; ré-importer un CSV duplique les magasins et la
   `Map` nom→id rattache les users arbitrairement au dernier doublon.
3. **Pas d'`errorFormatter` tRPC** — `error.message` brut part au client même en prod
   (vérifié dans le dist @trpc/server : seul `stack` est gated par isDev). Ex. concret :
   `markDone` avec UUID inexistant → texte Postgres (FK, noms de tables) renvoyé au client.
4. **`FAQ_RELEVANCE_THRESHOLD` documentée mais non mappée dans `web.environment` du
   compose** — la poser dans l'UI Dokploy ne fait RIEN (même piège que les BOOTSTRAP_*
   que le compose documente lui-même). Fix : 1 ligne dans docker-compose.yml.
5. **Desktop : aucune déconnexion possible** — LogoutButton n'existe que sur `/profil`,
   qui n'est lié nulle part en desktop (l'avatar pointe `/compte/mot-de-passe`).
6. **`LoginForm` : `signIn` sans try/catch** — erreur réseau = bouton bloqué sur
   « Connexion… » à vie.
7. **Contrastes WCAG AA** — `--color-sub` ≈3,9:1 et `--color-faint` ≈2,2:1 sur carte,
   portés par du texte 11-14,5 px partout.
8. **Import CSV : encodage Windows-1252 non géré** — Excel FR par défaut → `L�a` créé
   tel quel en base, silencieusement.
9. **`basculeDate: z.string()` sans format** côté tRPC (le CSV impose YYYY-MM-DD) →
   erreur Postgres brute.

## 🆕 MINOR notables inédits

- **SIGTERM non forwardé** : `CMD sh -c "... && node server.js"` sans `exec` → chaque
  redeploy finit en SIGKILL après timeout.
- **BRAIN** : body de la 1re réponse 400/404 jamais `cancel()` avant le retry (socket
  retenu undici) ; `reader.cancel()` manquant côté client après `event: error` ; pas
  d'AbortController dans useBrainChat (pas de bouton stop, setState après unmount) ;
  `FeedbackButtons` sans `onError` → 👍 cliqué avant l'INSERT fire-and-forget = vote
  perdu affiché comme enregistré ; une erreur mi-stream **remplace** le texte déjà
  streamé au lieu de l'annoter.
- **Embed-lab** : en parent-child l'overlap est affiché ET annoncé au juge alors qu'il
  n'est pas appliqué (biais doux) ; estimation de coût UI dépassable (~×3 possible sur
  grosses configs) ; `history.slice(-30)` fait ressortir les vieilles configs de la
  dédup ; un tour de refine en échec fait disparaître la carte reco alors que bestSoFar
  existe ; séparateur brut (non échappé) dans les blocs historiques du prompt.
- **Auth** : pas de `.max()` sur les mots de passe (argon2 sur entrée de plusieurs Mo) ;
  content-type uploads = déclaration client (pas de magic bytes) ; `maxAge` JWT défaut
  30 jours non explicité ; params non-UUID → 500 au lieu de 404.
- **Front** : « plus que aujourd'hui » (élision) ; J-N calculé en UTC → +1 jour entre
  00h et 02h Paris l'été ; formulaires user en `<div>`+onClick (Entrée ne soumet pas) ;
  méta factices (« ~45 min ») visibles en prod ; pas d'empty state formations.
- **Infra/qualité** : `@auth/drizzle-adapter` dep inutilisée ; `useBrainChat.test.ts`
  égaré dans `src/` ; `tests/sanity.test.ts` placeholder ; 4 routers tRPC entiers sans
  test (formation, news, progress, store) ; DEPLOY.md cite un CMD de boot faux.

## Corrections apportées aux passes Opus

- `migrate.mjs` « exit 0 même en échec » (passe A) : **faux** — le top-level await rejeté
  donne bien exit 1, fail-loud correct. Restent valables : advisory lock + retry + message
  d'erreur explicite.
- « Client coupe le stream = connexion Dify orpheline » : **partiellement faux** — pendant
  le streaming l'annulation se propage via `pipeThrough` ; le vrai trou est limité à la
  phase de connexion (avant le 1er byte) + l'absence de timeout.

## Confirmations (consensus 3 passes — rien à re-débattre)

Rate-limit login absent + timing oracle ; formula injection CSV (follow-up jamais traité) ;
race persist/purge conversationId (l'ordre id-puis-error n'est PAS testé) ; aucun timeout
fetch Dify ; `configKey` non normalisé ; verdict OCR refine sans hash fichier ; PDF bomb
(chunking non borné) ; error/not-found/loading.tsx absents ; `redSoft`→`redsoft` ;
garde navigation Tiptap ; Gazette inaccessible mobile ; email non lowercasé hors CSV ;
bootstrap sans bump `password_changed_at` ; pg_advisory_lock manquant ; CI absente ;
headers sécurité absents ; script typecheck absent ; timestamps sans timezone ; purge
RGPD non implémentée ; labels a11y non associés.

---

# Passe D — second run Fable 5 (différentiel)

Run indépendant de la passe C, même jour. **Confirme FB-C1 Tiptap** par une seconde
vérification indépendante dans `@tiptap/core` (content initial-only, `setOptions` ne
ré-applique jamais le doc) : deux passes Fable aveugles l'une de l'autre arrivent à la
même conclusion — quasi-certitude, repro UI restant la validation finale. Confirme aussi
indépendamment : claims JWT role/storeId figés, `stores.name` sans UNIQUE, logout desktop
introuvable, SIGTERM sans `exec`, bootstrap-admin sans bump, élision « plus que
aujourd'hui », J-N UTC, erreur mi-stream qui écrase le texte streamé, body 400/404 non
`cancel()` avant retry, perte de la carte reco sur échec de refine.

## Inédits passe D — IMPORTANT/MOYEN

**Thème majeur raté par les 3 passes précédentes : fidélité de la simulation embed-lab
vs le splitter Dify réel** (toutes les approximations vont dans le même sens — chunks
simulés plus gros et moins nombreux que ce que Dify produira) :
- **Tokenizer o200k_base** (gpt-tokenizer main = GPT-4o) alors que Dify compte en
  cl100k/GPT2 — écart 10-30 % sur du français, un chunk simulé « 1024 tk » dépasse la
  limite réelle (`chunker.ts:3-7`, docstring faux).
- **`chunkGeneral` merge les segments** (style langchain) et re-split par fenêtres dures
  de tokens, là où le splitter séparateur-fixe de Dify ne merge pas et re-split
  récursivement par sous-séparateurs (`chunker.ts:86-97`). À valider contre la version
  Dify déployée.
- **Parent-child : un seul délimiteur simulé/affiché** alors que l'UI Dify en demande
  deux (parent + enfant) — la reco copiable est incomplète pour ce mode (`types.ts`,
  `dify-settings.ts`).
- **Le juge n'est pas informé que les 15 chunks sont échantillonnés non-contigus**
  (début/milieu/fin renumérotés 1..15) → faux défauts « idées fragmentées » aux coutures.
- **PDFs owner-protected rejetés à tort** : `PDFDocument.load` sans `ignoreEncryption`
  → `pdf_unreadable` APRÈS une extraction unpdf réussie (`extract.ts:50`) — cas fréquent
  en docs d'entreprise.

**BRAIN** :
- **Auto-heal déclenché sur N'IMPORTE QUEL 400** sans lire le code d'erreur Dify
  (`route.ts:71`) : un 400 `invalid_param`/`app_unavailable`/quota purge
  `difyConversationId` → perte définitive du contexte de conversation pour une simple
  erreur d'input. Fix : lire le body (résout aussi le `cancel()` manquant) et ne reset
  que sur les codes conversation.
- Course 2 onglets sans conversation : 2 conversations Dify créées, last-write-wins —
  fix write-once `WHERE dify_conversation_id IS NULL`.
- `hasRelevantSource` figé au seuil du moment de l'INSERT : changer
  `FAQ_RELEVANCE_THRESHOLD` n'est pas rétroactif alors que `retrievalScoreMax` est
  stocké — filtrer à la lecture.
- `BrainPage` 500 entière si la query suggestions throw (le fallback ne couvre que la
  liste vide) — `.catch(() => [])`.

**Serveur/DB** :
- **`formations.delete` orpheline tous les PDF du volume** (cascade DB mais aucun
  `fs.rm`, contrairement à `news.delete`) — fichiers irrécupérables (`admin.ts:143-153`).
- **`admin.news.list` embarque `contentHtml` complet de tous les articles** sans
  projection ni pagination (`admin.ts:328-330`) — croissance non bornée.
- Nuance bootstrap-admin : un bump naïf de `password_changed_at` déconnecterait l'admin
  à CHAQUE boot (le script réécrit le hash à chaque démarrage) — il faut
  `argon2.verify` d'abord et ne bumper que si le mot de passe a réellement changé.
- `sharepointUrl` accepte `javascript:` — **vérifié par exécution** : zod 4 `.url()` ne
  filtre pas le scheme. Fix : `z.url({ protocol: /^https?$/ })`.
- Import CSV : **un seul `;` en trop → tout l'import rejeté** (papaparse ajoute
  `__parsed_extra: string[]`, `z.record(z.string(), z.string())` rejette — vérifié par
  exécution) avec message zod anglais sans numéro de ligne.
- Révocation : `users.update` storeId/role + `validatePasswordFreshness` font déjà un
  SELECT par session-read — y étendre la projection role/storeId est le fix à coût nul.

**Frontend** : bouton « Voir » sur un brouillon → 404 garanti (`news.bySlug` rejette
les drafts) ; « Publier » n'enregistre pas les modifications en cours (piège distinct
de la garde de navigation) ; le gotcha Basic Auth couvre **tout `/api/trpc`** via
httpBatchLink, pas seulement les uploads — le bypass proxy doit couvrir `/api/*` entier.

**Infra** :
- **Aucune stratégie de backup Postgres** (`cockpit_pgdata` = copie unique, zéro mention
  pg_dump dans docs/) — perte totale possible.
- **Logs Docker non bornés** (pas de `logging:` max-size sur web/db, VPS partagé).
- migrate.mjs sans retry × `restart: unless-stopped` = **crash-loop** qui ré-exécute
  migrations+bootstrap en boucle (depends_on ne protège qu'au premier start).

## Inédits passe D — MINOR (sélection)

Auth : session sans `maxAge` (JWT 30 j par défaut — amplifie les claims figés) ;
download PDF sans `Cache-Control: private/no-store` (la cover en a un) ; cover de
BROUILLON servie à tout employé connecté (pas de check status) ; pas de `nosniff` sur
les fichiers servis. DB : `basculeDate`/slug non contraints côté zod (erreur Postgres
22007 brute) ; FK violation 23503 non mappée (500 au lieu de 400) ; newlines non
échappés dans le CSV faq-gaps ; `sortOrder` max+1 hors transaction ; reorder accepte
des ids inexistants/partiels. Embed : payload refine peut crever 64 Ko avec message
trompeur ; pas de dédup intra-réponse tentative 1 ; `configKey` inclut des champs morts
en parent-child ; `childMaxTokens ≥ parentMaxTokens` accepté ; bornes min/max absentes
des input_schema (un coverage 1.05 fait échouer tout le run) ; `�` possibles aux
coupes de tokens ; changement de modèle entre tours non tracé ; hint « resélectionnez
le PDF » inatteignable + round gonflé sur échec HTTP ; ~3-4 copies du PDF en RAM.
Front : grille formations sans empty state ; CLS cover article ; erreurs zod brutes
en anglais dans les forms admin ; `docCount` jamais recalculé à l'upload/suppression
(structurel, pas éditorial) ; upload `pages` accepte les négatifs + ligne `fileUrl:''`
si l'update finale échoue ; dateline Gazette en TZ serveur ; titre d'onglet unique
partout ; `aria-current` absent BNav/AdminNav ; download 25 Mo chargé en RAM.
Infra : pas de limites mem/CPU compose ; tag `node:24-alpine` flottant ; pas de cache
mount npm ; coverage vitest non configurée ; scripts de boot ni testés ni typecheckés ;
`noUncheckedIndexedAccess` absent ; `lint` sans `--max-warnings 0` (no-unused-vars
décorative) ; `poweredByHeader` non désactivé ; argon2 non overlayé explicitement dans
le runner (dépendance implicite à la trace standalone).

## Faux positifs / recalibrages passe D

- **« Abort client non propagé » (passe A IMP-2)** : converge avec la passe C —
  pendant le streaming, l'annulation se propage via `pipeThrough` ; le trou réel =
  phase avant 1er byte + absence de timeout. Le fix `AbortSignal.any` reste le bon.
- **Lockout self-demote (passe B)** : recontextualisé — la rétrogradation n'affectant
  pas la session en cours (claims figés), l'admin self-demoted peut se ré-promouvoir ;
  le problème dominant est la révocation ineffective, pas le lockout.
- **MIME falsifiable** : sévérité à baisser — Content-Type re-forcé au service, jamais
  exécuté ; hygiène, pas sécurité. **CSV credentials** : périmètre réduit — le charset
  des mots de passe générés exclut `=+-@`, seul l'email reste vecteur.
- **Hash fichier au refine** : mitigé — le `onChange` file input fait `reset()` avant
  `setFile`, le scénario « autre PDF + ancien verdict OCR » exige de forger la requête.
  Defense-in-depth souhaitable, pas un bug atteignable.
- **Timing oracle login** : LOW — écart noyé dans la gigue réseau, à traiter avec le
  rate-limit. **UUID non validés** : MINOR robustesse (500 au lieu de 404), pas une
  faille d'accès. **CSRF** : sain par défaut implicite (SameSite=Lax non explicité).
- Pistes fermées saines : `migrate.mjs` exit 1 correct (faux positif passe A confirmé) ;
  pas de mutation delete users/stores (cascades non exercées) ; seed guard correct ;
  `uniqueNewsSlug` LIKE non injectable (slugify) ; suggestions CRUD sain ; mémoire
  serveur answer bornée ; non-SSE Traefik = sous-cas « bulle vide » connu ;
  `/api/health` liveness-only documenté et justifié ; `db:push` inexistant ;
  `prefers-reduced-motion` géré ; pas de sur-sérialisation RSC.

## Impact sur la roadmap consolidée (7 PRs)

La roadmap de `2026-06-09-full-code-review.md` reste valide. Ajouts cumulés C+D :
- **PR ⑤ frontend** : + FB-C1 Tiptap (EN PREMIER — bug destructif, confirmé 2×),
  + logout desktop, + try/catch signIn, + contrastes, + Voir-sur-brouillon, + Publier
  vs modifications non sauvées, + empty state formations.
- **PR ⑥ sécurité** : + claims JWT role/storeId rafraîchis (étendre la projection de
  validatePasswordFreshness — coût nul), + errorFormatter tRPC, + UNIQUE stores.name,
  + .max() mots de passe, + `z.url({protocol:/^https?$/})` sharepointUrl, + Cache-Control
  private downloads, + maxAge session.
- **PR ④ boot** : + `exec node server.js` (ou `init: true`), + mapping
  FAQ_RELEVANCE_THRESHOLD compose, + backup pg_dump + rotation logs + retry migrate
  (crash-loop), + fs.rm des PDF dans formations.delete.
- **PR ① BRAIN** : + cancel() du body avant retry, + onError FeedbackButtons,
  + discriminer le code d'erreur Dify avant de purger l'id (400 ≠ conversation morte),
  + write-once conversationId, + seuil faq-gaps à la lecture, + catch suggestions.
- **PR ③ CSV** : + strip `__parsed_extra`, + encodage Windows-1252, + newlines.
- **PR ⑦ embed-lab** : + thème fidélité simulation (tokenizer cl100k, comportement
  merge/récursif à valider vs version Dify déployée, childSeparator, note
  d'échantillonnage au juge, ignoreEncryption), + persistance bestSoFar sur échec
  de refine, + bornes input_schema.
