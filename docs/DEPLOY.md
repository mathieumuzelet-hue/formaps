# Déploiement — Dokploy + Traefik

Le portail Cockpit se déploie comme une application **docker-compose** sur
Dokploy. La pile contient deux services :

- `web` — l'app Next.js (image construite via le `Dockerfile`), exposée par Traefik.
- `db` — un Postgres 16 dédié, **non exposé publiquement**, avec un volume persistant.

Les migrations Drizzle sont appliquées **automatiquement au démarrage** du
conteneur `web` (`node scripts/migrate.mjs && node server.js`). Si une migration
échoue, le conteneur s'arrête (fail loud) — c'est volontaire.

## 1. Créer l'application

1. Dans Dokploy, créer une application de type **Compose** depuis le dépôt GitHub.
2. Brancher la branche de déploiement (`main`). L'**auto-déploiement au push sur
   `main`** est activé par Dokploy.

## 2. Variables d'environnement

À renseigner dans l'UI Dokploy (jamais commitées) :

| Variable            | Description                                                        |
| ------------------- | ----------------------------------------------------------------- |
| `DOMAIN`            | Domaine public (ex. `cockpit.example.com`)                        |
| `POSTGRES_USER`     | Utilisateur de la base dédiée                                      |
| `POSTGRES_PASSWORD` | Mot de passe de la base                                            |
| `POSTGRES_DB`       | Nom de la base                                                     |
| `AUTH_SECRET`       | Secret de session Auth.js — `openssl rand -base64 32`            |
| `DIFY_API_URL`      | Base API Dify, ex. `https://live.apsbot.fr/v1` (le `/v1` final est toléré ; on appelle `/v1/chat-messages`). URL publique simple, ou URL réseau interne si réseau Docker partagé |
| `DIFY_API_KEY`      | Clé API de l'app Dify                                              |
| `BOOTSTRAP_ADMIN_EMAIL`     | (option) email de l'admin créé au boot                    |
| `BOOTSTRAP_ADMIN_PASSWORD`  | (option) mot de passe de cet admin                        |
| `BOOTSTRAP_ADMIN_FIRSTNAME` | (option) prénom affiché, défaut `Admin`                   |
| `FAQ_RELEVANCE_THRESHOLD`   | Seuil de pertinence (0..1) du log FAQ BRAIN. Défaut `0.5` |

`DATABASE_URL` est dérivée automatiquement des `POSTGRES_*` dans le compose
(`postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}`).

⚠️ **`POSTGRES_PASSWORD` doit être alphanumérique** (pas de `@ : / # %`…), sinon il
casse le `DATABASE_URL` dérivé. Et il n'est appliqué qu'à la **première création** du
volume : pour le changer ensuite, supprimer le volume (`docker volume rm
<projet>_cockpit_pgdata`) puis redéployer, sinon `password authentication failed`.

### Premier compte admin (bootstrap par env)

Définir `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` : au démarrage, le conteneur
crée (ou met à jour le mot de passe d') un compte **admin non rattaché à un magasin**, de
façon **idempotente** (rejoué à chaque boot). Laisser vide pour ne rien créer. Tant qu'aucun
compte n'existe, c'est le seul moyen de se connecter (le seed de démo ne tourne pas en prod).
Le mot de passe vit dans l'env Dokploy = source de vérité ; un redéploiement le réaligne.

### Données & purge (RGPD)

La table `chat_queries` enregistre les **questions posées au chat BRAIN** afin
d'alimenter la page admin « Trous FAQ ». Ce texte libre peut contenir des
**données personnelles** (saisie par un utilisateur identifiable).

- **Durée de rétention cible : 12 mois maximum.**
- La purge est **automatisée depuis la PR sécurité (2026-06-11)** : au boot du
  conteneur web puis toutes les 24 h (`src/instrumentation.ts` →
  `src/server/jobs/purge-chat-queries.ts`). Rétention configurable via
  `CHAT_QUERIES_RETENTION_MONTHS` (défaut 12 mois).
- Filet manuel si besoin (mêmes effets que le job) :

```sql
DELETE FROM chat_queries WHERE created_at < now() - interval '12 months';
```

## 3. Domaine + réseau Traefik (points critiques)

1. **Déclarer le domaine dans l'UI Dokploy** ET vérifier qu'il correspond
   **exactement** au label Traefik du compose :
   `traefik.http.routers.cockpit.rule=Host(`${DOMAIN}`)`.
   Un domaine présent d'un seul côté = routeur orphelin / 404-500.
2. **Confirmer le nom du réseau Traefik externe**. Le compose déclare
   `dokploy-network` (`external: true`) — c'est le nom usuel sur Dokploy, mais
   il **doit correspondre** au réseau Traefik réel du VPS. Vérifier avec
   `docker network ls` et ajuster `docker-compose.yml` + le label
   `traefik.docker.network` si nécessaire.
3. **Certresolver** : le label utilise `letsencrypt` (défaut Dokploy). Ajuster si
   votre instance Traefik utilise un autre nom de resolver.

## 4. Joignabilité de Dify

Dify tourne dans un conteneur **séparé** sur le même VPS (non déployé ici). Pour
que `web` l'atteigne via `DIFY_API_URL`, les deux doivent partager un réseau
Docker. Soit pointer `DIFY_API_URL` vers une URL routable (ex. via le réseau
Traefik partagé), soit ajouter le réseau de Dify au service `web`. À confirmer
selon la topologie réseau du VPS.

### Labo d'embed (admin)

L'outil `/admin/embed-test` appelle l'API Claude d'Anthropic (facturé à l'usage,
indépendant de Dify et de l'abonnement Claude). Poser dans l'UI Dokploy :

- `ANTHROPIC_API_KEY` — clé API console.anthropic.com.

Sans la clé, la page répond « Clé API Anthropic non configurée » (503) ; le
reste de l'application n'est pas affecté. Aucun document n'est stocké : le PDF
est traité en mémoire et le rapport est éphémère.

## 5. Vérifier le déploiement

1. Attendre que le conteneur `web` devienne **`healthy`** (healthcheck
   `wget http://127.0.0.1:3000/api/health`).
   **Tant que le conteneur n'est pas `healthy`, Traefik refuse silencieusement
   de créer son routeur** → 404/500. Toujours vérifier la santé **avant** de
   débugger Traefik.
2. Vérifier les logs : `migrations appliquées` doit apparaître au boot.
3. Ouvrir `https://${DOMAIN}` — l'écran de connexion doit s'afficher.

## Dépannage (gotchas connus)

- **Healthcheck rouge / conteneur `unhealthy`** :
  - Le serveur Next.js standalone se bind sur le **hostname Docker auto**, pas
    sur `0.0.0.0`. L'image fixe `HOSTNAME=0.0.0.0` — ne pas l'écraser.
  - Le healthcheck utilise `127.0.0.1` (et **pas** `localhost`) : sous
    Alpine/BusyBox, `localhost` résout d'abord en IPv6 et le check échoue.
- **Routeur Traefik invisible malgré les labels** : conteneur `unhealthy` (voir
  ci-dessus) — corriger la santé d'abord.
- **502/504 sur le domaine** : vérifier que `web` est bien attaché au réseau
  Traefik (`dokploy-network`) et que `traefik.docker.network` pointe dessus.
- **Boot en boucle / exit au démarrage** : échec de migration — vérifier
  `DATABASE_URL` (donc les `POSTGRES_*`) et que le service `db` est `healthy`.
