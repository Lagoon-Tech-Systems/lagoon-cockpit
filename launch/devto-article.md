---
title: "I Built a Mobile DevOps Dashboard Because Checking Production Shouldn't Require a Laptop"
published: false
description: "Lagoon Cockpit: an open-source mobile app for managing Docker containers, Compose stacks, and server health from your phone."
tags: devops, docker, opensource, reactnative
canonical_url: https://github.com/Bigabou007-dev/lagoon-cockpit
cover_image:
---

## The Problem

It's 11 PM. You get a Telegram alert: a container is down on your production server.

You're not at your desk. Your options:
1. SSH from your phone (painful)
2. Open Portainer on mobile Safari (even more painful)
3. Drive back to your laptop

None of these are great. I've been managing Docker infrastructure on a VPS for a while now, and I kept running into the same frustration: **there's no good mobile-native tool for Docker management**.

Portainer, Rancher, and similar tools are excellent — but they're desktop-first web UIs. On a phone, you're pinch-zooming and fighting responsive layouts that weren't designed for a 6-inch screen.

So I built **Lagoon Cockpit**.

## What It Is

Lagoon Cockpit is an open-source, mobile-first DevOps dashboard. It has two parts:

1. **A lightweight API** (`cockpit-api`) — a Docker container that runs on your server and talks to the Docker Engine via the unix socket
2. **A native mobile app** — built with Expo/React Native, designed for phone screens

```
Phone (Expo app)
  │ HTTPS
  │
[cockpit-api]  ← Docker container on your server
  ├── Docker Engine API (/var/run/docker.sock)
  ├── /proc (system metrics)
  └── SQLite (users, audit log)
```

The API container uses ~22MB of RAM and 0% CPU at idle. It's not another heavy monitoring platform — it's a thin layer between your phone and your Docker daemon.

## Features

### Grand Overview Dashboard
One screen shows you everything: CPU, RAM, disk usage, container count, stack health, and recent alerts. Pull to refresh.

### Container Management
Browse all containers with status indicators. Tap into any container to see:
- Live CPU and memory stats
- Network I/O and PID count
- Full log output (last 200 lines)
- Start / Stop / Restart buttons with confirmation dialogs

### Docker Compose Stack Management
Containers are automatically grouped by their `com.docker.compose.project` label — no config needed. You can start, stop, or restart an entire stack at once.

### SSL & Endpoint Monitoring
Configure your domains and HTTP endpoints in the `.env` file. The API probes them on request and shows you:
- HTTP status codes and response times
- SSL certificate expiry (days remaining, color-coded)

### Real-Time Updates via SSE
The API broadcasts system metrics and container state changes every 15 seconds via Server-Sent Events. The mobile app auto-reconnects on network changes.

### Security
- **No public ports** — the API container exposes nothing. Access it via Tailscale, VPN, or a reverse proxy with IP restriction.
- **Dual auth**: API key mode (single admin) or multi-user mode with roles (admin/operator/viewer)
- **Biometric lock** on the mobile app (fingerprint/face)
- **JWT with refresh tokens**, rate limiting, audit logging
- All container IDs and stack names are validated to prevent path traversal on the Docker socket

### Multi-Server
The mobile app supports multiple server profiles. Add your production, staging, and dev servers — switch between them from any screen.

## How the Docker API Client Works

Instead of shelling out to `docker ps` and parsing text (fragile, slow, blocks the event loop), the API talks directly to the Docker Engine REST API via the unix socket:

```javascript
const http = require("http");

function dockerAPI(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: "/var/run/docker.sock",
      path: `/v1.43${path}`,
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        resolve(JSON.parse(raw));
      });
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// List all containers
const containers = await dockerAPI("GET", "/containers/json?all=true");

// Get one-shot stats
const stats = await dockerAPI("GET", `/containers/${id}/stats?stream=false`);

// Restart a container
await dockerAPI("POST", `/containers/${id}/restart`);
```

Zero dependencies for the Docker client. Node.js's built-in `http` module handles unix sockets natively.

## Stack Discovery Without Config

Docker Compose automatically labels containers with `com.docker.compose.project`. We use this to group containers into stacks without needing access to compose files:

```javascript
const containers = await dockerAPI("GET", "/containers/json?all=true");
const stacks = {};
for (const c of containers) {
  const project = c.Labels["com.docker.compose.project"];
  if (project) {
    (stacks[project] ??= []).push(c);
  }
}
```

This means the API doesn't need to mount your compose files — it discovers stacks purely from Docker labels.

## Quick Start

### Deploy the API (2 minutes)

```bash
git clone https://github.com/Bigabou007-dev/lagoon-cockpit.git
cd lagoon-cockpit/packages/api

# Configure
cp .env.example .env
# Edit .env: set API_KEY, JWT_SECRET, SERVER_NAME

# Deploy
docker compose up -d
```

The container joins your Docker network with no public ports. Access it via your VPN or reverse proxy.

### Run the Mobile App

```bash
cd lagoon-cockpit/packages/app
npm install
npx expo start
```

Scan the QR code with Expo Go on your phone. Add your server URL + API key, and you're in.

## What's Next

- [ ] Terminal/exec into containers from the app
- [ ] Docker image pull/update
- [ ] Resource usage graphs (historical)
- [ ] Webhook integrations (Slack, Discord)
- [ ] App Store / Play Store release

## Try It

GitHub: [github.com/Bigabou007-dev/lagoon-cockpit](https://github.com/Bigabou007-dev/lagoon-cockpit)

MIT licensed. Stars, issues, and PRs welcome.

---

*Built by [Lagoon Tech Systems](https://lagoontechsystems.com) — we build digital infrastructure for businesses in West Africa.*
