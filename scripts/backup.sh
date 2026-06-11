#!/bin/sh
# Backup quotidien Cockpit : pg_dump (DB) + tar (volume uploads) → bucket S3/R2.
# Modes : `backup.sh once` — un run puis exit (test manuel) ;
#         `backup.sh loop` — un run puis sleep 24 h, indéfiniment (défaut compose).
# Fail-soft : envs BACKUP_S3_* absents → avertissement et attente, jamais de
# crash-loop. Un échec dump/upload est loggé et retenté au cycle suivant.
# Rétention : règle de lifecycle côté bucket (voir docs/DEPLOY.md), pas ici.
set -u

INTERVAL_S="${BACKUP_INTERVAL_S:-86400}"

log() { echo "[backup] $(date -u +%FT%TZ) $*"; }

config_ok() {
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] && [ -n "${BACKUP_S3_BUCKET:-}" ] \
    && [ -n "${BACKUP_S3_ACCESS_KEY:-}" ] && [ -n "${BACKUP_S3_SECRET:-}" ]
}

# $1 = fichier local, $2 = clé distante
upload() {
  curl --fail --silent --show-error \
    --aws-sigv4 "aws:amz:auto:s3" \
    --user "${BACKUP_S3_ACCESS_KEY}:${BACKUP_S3_SECRET}" \
    --upload-file "$1" \
    "https://${BACKUP_S3_ENDPOINT}/${BACKUP_S3_BUCKET}/$2"
}

run_backup() {
  day="$(date -u +%F)"
  db_file="/tmp/db-${day}.dump"
  up_file="/tmp/uploads-${day}.tar.gz"

  if pg_dump --format=custom --file="$db_file" "$DATABASE_URL"; then
    log "pg_dump OK ($(du -h "$db_file" | cut -f1))"
    if upload "$db_file" "cockpit/db-${day}.dump"; then
      log "upload db OK -> cockpit/db-${day}.dump"
    else
      log "ERREUR upload db (retry au prochain cycle)"
    fi
  else
    log "ERREUR pg_dump (retry au prochain cycle)"
  fi
  rm -f "$db_file"

  if tar -czf "$up_file" -C /uploads .; then
    log "tar uploads OK ($(du -h "$up_file" | cut -f1))"
    if upload "$up_file" "cockpit/uploads-${day}.tar.gz"; then
      log "upload uploads OK -> cockpit/uploads-${day}.tar.gz"
    else
      log "ERREUR upload uploads (retry au prochain cycle)"
    fi
  else
    log "ERREUR tar uploads (retry au prochain cycle)"
  fi
  rm -f "$up_file"
}

mode="${1:-loop}"

if [ "$mode" = "once" ]; then
  if config_ok; then
    run_backup
    exit 0
  fi
  log "BACKUP_S3_* incomplets — rien a faire"
  exit 1
fi

while :; do
  if config_ok; then
    run_backup
  else
    log "AVERTISSEMENT : BACKUP_S3_* incomplets — backups offsite INACTIFS (poser les 4 envs dans l'UI Dokploy)"
  fi
  sleep "$INTERVAL_S"
done
