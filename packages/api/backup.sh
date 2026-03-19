#!/usr/bin/env bash
# ---------------------------------------------------------------
# Lagoon Cockpit API — SQLite Backup Script
#
# Backs up cockpit.db from the Docker volume to a local directory
# with timestamped filenames. Keeps the last N backups (default 7).
#
# Usage:
#   ./backup.sh                     # defaults: ./backups, keep 7
#   ./backup.sh /mnt/nas/backups 14 # custom dir, keep 14
#
# Can be added to cron:
#   0 3 * * * /path/to/backup.sh >> /var/log/cockpit-backup.log 2>&1
# ---------------------------------------------------------------

set -euo pipefail

CONTAINER_NAME="lagoon_cockpit_api"
DB_PATH="/app/data/cockpit.db"
BACKUP_DIR="${1:-$(dirname "$0")/backups}"
KEEP="${2:-7}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/cockpit_${TIMESTAMP}.db"

# ---- Preflight checks ----

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "[ERROR] Container '$CONTAINER_NAME' is not running." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ---- Create backup using SQLite .backup command ----
# This uses SQLite's own backup API, which is safe even while the
# database is being written to (no need to stop the container).

echo "[$(date -Iseconds)] Starting backup of $CONTAINER_NAME:$DB_PATH ..."

docker exec "$CONTAINER_NAME" sqlite3 "$DB_PATH" ".backup /tmp/cockpit_backup.db"
docker cp "$CONTAINER_NAME:/tmp/cockpit_backup.db" "$BACKUP_FILE"
docker exec "$CONTAINER_NAME" rm -f /tmp/cockpit_backup.db

# ---- Verify the backup ----

if [ ! -s "$BACKUP_FILE" ]; then
  echo "[ERROR] Backup file is empty or missing: $BACKUP_FILE" >&2
  exit 1
fi

FILE_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
echo "[$(date -Iseconds)] Backup complete: $BACKUP_FILE ($FILE_SIZE bytes)"

# ---- Integrity check ----

if command -v sqlite3 &>/dev/null; then
  INTEGRITY=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>&1)
  if [ "$INTEGRITY" = "ok" ]; then
    echo "[$(date -Iseconds)] Integrity check: PASSED"
  else
    echo "[WARN] Integrity check returned: $INTEGRITY" >&2
  fi
else
  echo "[INFO] sqlite3 not found on host — skipping integrity check."
fi

# ---- Rotate old backups ----

BACKUP_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'cockpit_*.db' -type f | wc -l)
if [ "$BACKUP_COUNT" -gt "$KEEP" ]; then
  DELETE_COUNT=$((BACKUP_COUNT - KEEP))
  echo "[$(date -Iseconds)] Rotating: removing $DELETE_COUNT old backup(s) (keeping $KEEP)"
  find "$BACKUP_DIR" -maxdepth 1 -name 'cockpit_*.db' -type f -printf '%T@\t%p\n' \
    | sort -n \
    | head -n "$DELETE_COUNT" \
    | cut -f2 \
    | xargs rm -f
fi

echo "[$(date -Iseconds)] Done."
