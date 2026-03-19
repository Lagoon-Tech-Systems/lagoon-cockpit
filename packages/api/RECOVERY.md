# Lagoon Cockpit API — Recovery Runbook

This document covers disaster recovery, common failure modes, and verification
procedures for the Lagoon Cockpit API container.

---

## 1. Rebuild and Redeploy from Scratch

```bash
cd packages/api

# Stop and remove the existing container
docker compose down

# Rebuild the image (no cache to ensure a clean build)
docker compose build --no-cache

# Start the container
docker compose up -d

# Verify it comes up healthy (wait ~30s for the first health check)
docker inspect --format '{{.State.Health.Status}}' lagoon_cockpit_api
```

If you use a `docker-compose.override.yml` for local overrides (container name,
networks), make sure it is present before running `docker compose up`.

### Full nuke (remove volume too)

> WARNING: This destroys all data including the SQLite database.

```bash
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

---

## 2. Restore the SQLite Database from Backup

The database lives inside a Docker volume mounted at `/app/data/cockpit.db`.

### Locate the volume on the host

```bash
docker volume inspect api_cockpit_data --format '{{.Mountpoint}}'
# Typically: /var/lib/docker/volumes/api_cockpit_data/_data
```

### Restore from a backup file

```bash
# Stop the container to avoid writes during restore
docker compose stop

# Copy the backup into the volume (requires root or docker group)
sudo cp /path/to/backup/cockpit.db /var/lib/docker/volumes/api_cockpit_data/_data/cockpit.db

# Remove any leftover WAL/SHM files so SQLite starts clean
sudo rm -f /var/lib/docker/volumes/api_cockpit_data/_data/cockpit.db-wal
sudo rm -f /var/lib/docker/volumes/api_cockpit_data/_data/cockpit.db-shm

# Restart
docker compose up -d
```

### Restore via docker cp (alternative)

```bash
docker compose up -d   # container must be running
docker compose stop    # then stop cleanly
docker cp /path/to/backup/cockpit.db lagoon_cockpit_api:/app/data/cockpit.db
docker compose start
```

---

## 3. Rotate the API Key and JWT Secret

Both values are set via environment variables. Update your `.env` file (or
`docker-compose.override.yml` environment section) and restart.

### Generate new values

```bash
# New API key (32 hex chars)
openssl rand -hex 16

# New JWT secret (64 hex chars)
openssl rand -hex 32
```

### Apply

```bash
# Edit .env
# API_KEY=<new-api-key>
# JWT_SECRET=<new-jwt-secret>

# Restart the container to pick up new values
docker compose up -d --force-recreate
```

After rotation:
- All existing JWT tokens are immediately invalidated (users must re-authenticate).
- All API clients must update their `X-API-Key` header to the new key.
- There is no graceful migration; this is a hard cutover.

---

## 4. Common Failure Modes

### Docker socket permission denied

**Symptom**: Container logs show `Error: connect EACCES /var/run/docker.sock`
or the Docker endpoints return 500.

**Fix**: The `node` user inside the container must belong to a group whose GID
matches the host's `docker` socket group.

```bash
# Find the host docker socket GID
stat -c '%g' /var/run/docker.sock

# Rebuild with the correct GID
docker compose build --build-arg DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
docker compose up -d
```

### Container OOM-killed

**Symptom**: Container restarts unexpectedly. `docker inspect` shows
`"OOMKilled": true`.

**Fix**: Increase the memory limit in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      memory: 512M   # was 256M
```

Then `docker compose up -d`. Also check for memory leaks by monitoring
`docker stats lagoon_cockpit_api` over time.

### Authentication lockout

**Symptom**: All API requests return 401 Unauthorized.

**Possible causes**:
1. API key was rotated but clients were not updated.
2. JWT secret was rotated and cached tokens are stale.
3. The `.env` file is missing or unreadable.

**Fix**:
```bash
# Verify the container has the expected env vars
docker exec lagoon_cockpit_api env | grep -E 'API_KEY|JWT_SECRET|AUTH_MODE'

# If wrong, fix .env and recreate
docker compose up -d --force-recreate
```

### Health check failing

**Symptom**: `docker ps` shows the container as `unhealthy`.

**Diagnose**:
```bash
# Check the health check log
docker inspect --format '{{json .State.Health}}' lagoon_cockpit_api | jq .

# Try the health endpoint manually
docker exec lagoon_cockpit_api wget -qO- http://localhost:3000/health
```

**Common causes**:
- The Node.js process crashed but the container is still running.
- Port 3000 is not listening (check `docker logs lagoon_cockpit_api`).
- `wget` is missing from the image (unlikely with `node:20-alpine` but verify).

### SQLite database locked

**Symptom**: API returns 500 errors with `SQLITE_BUSY`.

**Fix**: Only one process should write to the database. If you have multiple
container replicas, scale down to 1. If the WAL file is corrupt:

```bash
docker compose stop
# Inside the volume directory:
sudo sqlite3 /var/lib/docker/volumes/api_cockpit_data/_data/cockpit.db "PRAGMA wal_checkpoint(TRUNCATE);"
docker compose start
```

---

## 5. Health Check Verification

### Quick check

```bash
# Container health status
docker inspect --format '{{.State.Health.Status}}' lagoon_cockpit_api
# Expected: healthy

# Direct health endpoint (from within the Docker network)
docker exec lagoon_cockpit_api wget -qO- http://localhost:3000/health

# From the host (if port is exposed or via reverse proxy)
curl -s http://localhost:3000/health
```

### Full verification checklist

```bash
# 1. Container is running
docker ps --filter name=lagoon_cockpit_api --format '{{.Status}}'

# 2. Health check is passing
docker inspect --format '{{.State.Health.Status}}' lagoon_cockpit_api

# 3. Resource usage is within limits
docker stats --no-stream lagoon_cockpit_api

# 4. Logs show no errors
docker logs --tail 50 lagoon_cockpit_api

# 5. Database file exists and is readable
docker exec lagoon_cockpit_api ls -la /app/data/cockpit.db

# 6. Docker socket is accessible
docker exec lagoon_cockpit_api ls -la /var/run/docker.sock

# 7. API responds to authenticated request
curl -s -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/api/system/info
```

---

## 6. Resource Caps Reference

The default resource configuration in `docker-compose.yml`:

| Setting            | Value  |
|--------------------|--------|
| CPU limit          | 0.25   |
| CPU reservation    | 0.10   |
| Memory limit       | 256 MB |
| Memory reservation | 64 MB  |
| Restart policy     | unless-stopped |
| Health interval    | 30s    |
| Health timeout     | 5s     |
| Health retries     | 3      |
| Health start period| 10s    |

Typical idle usage is ~16 MB RAM and near-zero CPU.
