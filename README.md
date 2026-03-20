# Lagoon Cockpit

**Open-source mobile DevOps command center for Docker infrastructure.** Monitor, manage, and automate your containers from your phone or terminal.

Built for DevOps engineers who need to resolve incidents without SSH.

---

## Why Lagoon Cockpit?

Portainer and Rancher are powerful — but they're desktop web UIs. When your server goes down at 2 AM, you're not at your desk. You're reaching for your phone.

Lagoon Cockpit gives you a **native mobile app** + **CLI tool** backed by a **lightweight API agent** on each server. No heavy dependencies. No Kubernetes required. Just Docker.

### What you can do

- **Dashboard**: CPU, RAM, disk gauges with auto-refresh and problem detection
- **Container management**: Start, stop, restart, bulk operations, inline actions
- **Compose stacks**: Manage entire stacks as groups
- **Run commands**: Execute whitelisted diagnostics inside containers from your phone
- **View logs**: Full log viewer with regex search
- **System map**: Visual node-graph of your entire infrastructure
- **Metrics history**: CPU/RAM/disk trends with sparkline charts (7-day retention)
- **Image management**: List, delete, prune unused Docker images
- **Network topology**: See which containers share networks with IPs
- **Disk breakdown**: Storage by category — containers, images, volumes, build cache
- **System prune**: One-tap cleanup to reclaim disk space
- **Alert rules**: Custom threshold-based alerts (e.g., CPU > 90% for 5 min)
- **Webhooks**: Fire events to Slack, Discord, n8n, or any HTTP endpoint
- **Scheduled actions**: Cron-based container automation (restart weekly, stop at night)
- **Maintenance mode**: Pause alerts during planned work
- **Activity feed**: Audit log of who did what and when
- **SSL monitoring**: Certificate expiry countdown
- **Endpoint probing**: HTTP health checks with response times
- **Push notifications**: Native mobile alerts when things break
- **Multi-server**: Connect to multiple VPS instances from one app
- **Biometric lock**: Face ID / fingerprint with auto-lock
- **CLI companion**: 20 terminal commands for the same API

---

## Architecture

```
┌────────────────────────────┐     ┌──────────────────┐
│  Mobile App (Expo/RN)      │     │  CLI (Node.js)   │
│  Biometric lock            │     │  cockpit overview │
│  Multi-server profiles     │     │  cockpit ps       │
│  Real-time SSE dashboard   │     │  cockpit exec ... │
└──────────┬─────────────────┘     └────────┬─────────┘
           │ HTTPS (Tailscale/VPN)           │
    ┌──────┴──────┐  ┌──────────────┐  ┌────┴─────────┐
    │ cockpit-api │  │ cockpit-api  │  │ cockpit-api  │
    │ Server A    │  │ Server B     │  │ Server C     │
    └─────────────┘  └──────────────┘  └──────────────┘
```

Each server runs its own `cockpit-api` container (~22 MB RAM). Both the mobile app and CLI connect to the same API.

---

## Quick Start

### 1. Deploy the API on your server

```bash
git clone https://github.com/Bigabou007-dev/lagoon-cockpit.git
cd lagoon-cockpit/packages/api
cp .env.example .env
# Edit .env: set API_KEY, JWT_SECRET, SERVER_NAME
docker compose up -d
```

### 2. Connect from mobile

Build the app with EAS or run in development:

```bash
cd lagoon-cockpit/packages/app
npm install
npx expo start
```

### 3. Or use the CLI

```bash
cd lagoon-cockpit/packages/cli
node src/index.js connect http://your-server:3000 your-api-key "My Server"
node src/index.js overview
```

---

## CLI Commands

```
cockpit connect <url> <key> [name]   Connect to a server
cockpit overview                     System dashboard with gauges
cockpit ps [running|stopped]         List containers with status
cockpit stacks                       List compose stacks
cockpit start/stop/restart <id>      Container actions
cockpit logs <id> [--tail N]         View container logs
cockpit logs <id> --search <query>   Search logs with regex
cockpit exec <id> <command>          Run command in container
cockpit images                       List Docker images
cockpit networks                     Show network topology
cockpit disk                         Disk usage breakdown
cockpit prune                        System prune
cockpit ssl                          SSL certificate status
cockpit endpoints                    HTTP endpoint probes
cockpit maintenance [on|off]         Toggle maintenance mode
cockpit audit                        View activity log
cockpit servers                      List configured servers
cockpit use <name>                   Switch active server
```

---

## API Endpoints (23)

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/token` | API key → JWT (single-admin) |
| POST | `/auth/login` | Email/password → JWT (multi-user) |
| POST | `/auth/refresh` | Refresh access token |

### Containers
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/containers` | viewer+ | List all containers |
| GET | `/api/containers/:id` | viewer+ | Detail + live stats |
| GET | `/api/containers/:id/logs` | viewer+ | Container logs |
| GET | `/api/containers/:id/logs/search` | viewer+ | Regex log search |
| GET | `/api/containers/:id/top` | viewer+ | Running processes |
| POST | `/api/containers/:id/start` | operator+ | Start |
| POST | `/api/containers/:id/stop` | operator+ | Stop |
| POST | `/api/containers/:id/restart` | operator+ | Restart |
| POST | `/api/containers/:id/exec` | admin | Run whitelisted command |
| POST | `/api/containers/:id/rebuild` | admin | Nuke & rebuild |
| POST | `/api/containers/bulk` | operator+ | Bulk start/stop/restart |

### Docker Resources
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/stacks` | viewer+ | List compose stacks |
| GET | `/api/networks` | viewer+ | Docker networks with IPs |
| GET | `/api/volumes` | viewer+ | Docker volumes |
| GET | `/api/images` | viewer+ | Docker images with sizes |
| POST | `/api/system/prune` | admin | System-wide cleanup |

### Monitoring & Automation
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/overview` | viewer+ | Full system dashboard |
| GET | `/api/metrics/history` | viewer+ | Historical metrics (sparklines) |
| GET | `/api/ssl` | viewer+ | SSL certificate expiry |
| GET | `/api/endpoints` | viewer+ | HTTP endpoint probes |
| GET/POST | `/api/alerts/rules` | admin | Custom threshold alerts |
| GET/POST | `/api/webhooks` | admin | Webhook integrations |
| GET/POST | `/api/schedules` | admin | Cron-based actions |
| GET/POST | `/api/maintenance` | admin | Maintenance mode |
| GET | `/api/audit` | admin | Activity log |
| GET | `/api/stream` | viewer+ | SSE real-time stream |

---

## Mobile App Screens

**5 tabs**: Overview, Containers, Stacks, Alerts, Manage

**Overview** — Interactive gauges, quick stats, problem containers, stack health, auto-refresh every 30s

**Containers** — Search + filter chips, bulk select mode, inline start/stop/restart actions. Detail view with 5 tabs: Stats, Logs (regex search), Exec (run commands), Env (with secret masking), Top (processes)

**Stacks** — Compose projects grouped by Docker labels, stack-level actions

**Alerts** — Real-time event feed from SSE stream

**Manage** — Hub linking to 10 management screens:
- System Map (visual node-graph)
- Disk Usage (breakdown by category + prune)
- Images (list, delete, prune)
- Networks (topology with container IPs)
- Metrics History (sparkline charts, 1h/6h/24h/7d)
- Alert Rules (custom thresholds)
- Webhooks (Slack/Discord/n8n integration)
- Scheduled Actions (cron-based automation)
- Activity Log (audit trail)
- Maintenance Mode (pause alerts)

---

## Security

- **No public ports** by default — connect via Tailscale, VPN, or reverse proxy
- **Exec whitelist**: Only pre-approved diagnostic commands, no shell interpretation, metacharacter blocking
- **SSRF protection**: Webhooks block private IPs, localhost, cloud metadata endpoints
- **Input validation**: All Docker IDs, names, and URLs validated with strict regexes
- **Constant-time auth**: API key comparison via SHA-256 + `timingSafeEqual`
- **JWT**: 15-minute access tokens, 7-day refresh tokens with rotation
- **Rate limiting**: 5 failed auth attempts → 15-minute lockout
- **Biometric lock**: Face ID / fingerprint with auto-lock after 2 minutes
- **Audit logging**: All actions logged to SQLite with user, target, and timestamp
- **Entry limits**: Max 50 webhooks, 100 alert rules, 50 scheduled actions
- **CLI security**: Config file stored with 0600 permissions, raw API keys not persisted

---

## Tech Stack

| Component | Stack |
|-----------|-------|
| **API** | Node.js 20, Express, Docker Engine API (unix socket), SQLite (better-sqlite3) |
| **Mobile** | Expo 55, React Native 0.83, expo-router, Zustand, expo-secure-store |
| **CLI** | Node.js, zero dependencies |
| **Deployment** | Docker (Alpine, ~45 MB image, ~22 MB runtime) |

---

## Contributing

PRs welcome. Please:

1. Follow existing code patterns
2. Test against a real Docker environment
3. Don't add heavy dependencies — the API is intentionally lightweight
4. Run the security checklist: input validation, role gating, audit logging

---

## License

[MIT](LICENSE) — Copyright 2026 [Lagoon Tech Systems](https://lagoontechsystems.com)
