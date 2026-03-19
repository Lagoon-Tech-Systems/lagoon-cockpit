# Lagoon Cockpit

**Mobile-first Docker management dashboard.** Monitor containers, compose stacks, system metrics, SSL certificates, and HTTP endpoints from your phone.

Built for DevOps engineers who need eyes on production without SSH.

---

## Why Lagoon Cockpit?

Portainer and Rancher are powerful — but they're desktop web UIs. When your server goes down at 2 AM, you're not at your desk. You're reaching for your phone.

Lagoon Cockpit gives you a **native mobile app** backed by a **lightweight API agent** that runs on each server. No heavy dependencies. No Kubernetes required. Just Docker.

- **See everything**: CPU, RAM, disk, load, uptime — at a glance
- **Manage containers**: Start, stop, restart with confirmation dialogs
- **Compose stacks**: Group containers by project, manage entire stacks
- **SSL monitoring**: Know when certificates are expiring
- **Endpoint probing**: HTTP health checks with response times
- **Real-time updates**: Server-Sent Events stream every 15 seconds
- **Push notifications**: Get alerted when containers go down
- **Multi-server**: Connect to multiple servers from one app
- **Secure**: Biometric lock, JWT auth, role-based access control

---

## Architecture

```
┌────────────────────────────┐
│  Mobile App (Expo/RN)      │
│  Biometric lock            │
│  Multi-server profiles     │
│  Real-time SSE dashboard   │
└──────────┬─────────────────┘
           │ HTTPS
    ┌──────┴──────┐  ┌──────────────┐
    │ cockpit-api │  │ cockpit-api  │
    │ Server A    │  │ Server B     │
    └─────────────┘  └──────────────┘
```

Each server runs its own `cockpit-api` container (~22 MB RAM). The mobile app stores server profiles and switches between them.

---

## Quick Start

### 1. Deploy the API on your server

```bash
git clone https://github.com/Bigabou007-dev/lagoon-cockpit.git
cd lagoon-cockpit/packages/api

# Configure
cp .env.example .env
# Edit .env: set API_KEY, JWT_SECRET, SERVER_NAME

# Deploy
docker compose up -d
```

The API runs on port 3000 inside the container. No ports are exposed by default — connect it to your reverse proxy network or expose a port as needed.

### 2. Run the mobile app

```bash
cd lagoon-cockpit/packages/app
npm install
npx expo start
```

Scan the QR code with Expo Go on your phone. Add your server URL and API key.

---

## API Endpoints

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/token` | Exchange API key for JWT (single-admin mode) |
| POST | `/auth/login` | Login with email/password (multi-user mode) |
| POST | `/auth/refresh` | Refresh access token |

### Containers

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/containers` | viewer+ | List all containers |
| GET | `/api/containers/:id` | viewer+ | Container detail + live stats |
| GET | `/api/containers/:id/logs` | viewer+ | Container logs |
| POST | `/api/containers/:id/start` | operator+ | Start container |
| POST | `/api/containers/:id/stop` | operator+ | Stop container |
| POST | `/api/containers/:id/restart` | operator+ | Restart container |

### Compose Stacks

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/stacks` | viewer+ | List compose projects |
| GET | `/api/stacks/:name` | viewer+ | Stack detail |
| POST | `/api/stacks/:name/start` | admin | Start all containers |
| POST | `/api/stacks/:name/stop` | admin | Stop all containers |
| POST | `/api/stacks/:name/restart` | admin | Restart all containers |

### System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/overview` | CPU, RAM, disk, container/stack summary |
| GET | `/api/system/metrics` | Detailed system metrics |
| GET | `/api/endpoints` | HTTP endpoint probe results |
| GET | `/api/ssl` | SSL certificate expiry |
| GET | `/api/stream` | SSE real-time stream |

---

## Auth Modes

### Single-admin (default)

Set `AUTH_MODE=key` in `.env`. One API key, one admin user. Simple.

```bash
curl -X POST http://localhost:3000/auth/token \
  -H 'Content-Type: application/json' \
  -d '{"apiKey": "your-key"}'
```

### Multi-user

Set `AUTH_MODE=users` in `.env`. SQLite-backed user accounts with roles:

| Role | Permissions |
|------|-------------|
| **admin** | Full control — manage containers, stacks, users |
| **operator** | Start/stop/restart containers, view everything |
| **viewer** | Read-only access to all dashboards |

The first admin is auto-created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`.

---

## Mobile App Screens

**Overview** — System gauges (CPU/RAM/disk), container and stack summary, recent alerts

**Containers** — Searchable list with status filters, tap for detail view with live stats, logs, and action buttons

**Stacks** — Compose projects grouped by Docker labels, stack-level start/stop/restart

**Status** — HTTP endpoint health checks with response times, SSL certificate expiry countdown

**Alerts** — Real-time event log from SSE stream, container state changes

---

## Configuration

See [`.env.example`](packages/api/.env.example) for all options:

```env
AUTH_MODE=key                    # "key" or "users"
API_KEY=your-secret              # For single-admin mode
JWT_SECRET=random-64-chars       # For signing tokens
SERVER_NAME=My Server            # Display name in the app
ENDPOINTS=API|https://...|200    # HTTP probes (optional)
SSL_DOMAINS=example.com          # SSL monitoring (optional)
```

---

## Tech Stack

**API**: Node.js 20, Express, Docker Engine API (unix socket), SQLite, zero-dep metrics from `/proc`

**Mobile**: Expo 55, React Native 0.83, expo-router, Zustand, expo-secure-store, expo-local-authentication

**Deployment**: Docker (Alpine, ~45 MB image, ~22 MB runtime)

---

## Security

- No public ports by default — connect via VPN or reverse proxy
- API key comparison uses constant-time hashing (SHA-256 + `timingSafeEqual`)
- JWT access tokens expire in 15 minutes, refresh tokens in 7 days
- Rate limiting: 5 failed auth attempts trigger 15-minute lockout
- Biometric lock on the mobile app with auto-lock after 2 minutes in background
- All container actions require operator+ role and are audit-logged
- Docker socket is the only privileged resource — no shell execution

---

## Contributing

Pull requests welcome. Please:

1. Follow the existing code style
2. Test your changes against a real Docker environment
3. Don't add heavy dependencies — the API is intentionally lightweight

---

## License

[MIT](LICENSE) — Copyright 2026 Lagoon Tech Systems
