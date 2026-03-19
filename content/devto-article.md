---
title: "I built a mobile DevOps dashboard because managing Docker from my phone shouldn't require SSH"
published: false
description: "Lagoon Cockpit is an open-source mobile-first dashboard for managing Docker infrastructure. Here's how I built it and why."
tags: docker, devops, reactnative, opensource
cover_image: ""
---

# I built a mobile DevOps dashboard because managing Docker from my phone shouldn't require SSH

You're at dinner. Your monitoring bot sends a Telegram alert: a container is down. You pull out your phone, open a terminal emulator, fat-finger your SSH key passphrase three times, finally get in, type `docker ps`, squint at truncated output on a 6-inch screen, and run `docker restart nginx`.

There had to be a better way.

## The problem

I run multiple services on a VPS -- websites, APIs, AppFlowy Cloud, n8n workflows, a reverse proxy. That's 16 containers across 5 Docker Compose stacks. Monitoring tools like Portainer and Rancher exist, but they're desktop-first web UIs. On mobile, they're painful.

What I wanted:
- **Native mobile app** with biometric lock
- **At-a-glance dashboard** showing CPU, RAM, disk, container health
- **Container management** -- start, stop, restart from a tap
- **Compose stack management** -- bring up/down entire services
- **SSL monitoring** -- know before certificates expire
- **Push notifications** -- not just Telegram, but native mobile alerts
- **Multi-server** -- manage staging, production, and dev from one app

## The architecture

**Lagoon Cockpit** is two things:

### 1. A lightweight API agent (per server)

A single Express.js container that talks to the Docker Engine API via the unix socket. No shell commands, no Docker CLI -- just raw HTTP against `/var/run/docker.sock`.

```js
function dockerAPI(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      socketPath: '/var/run/docker.sock',
      path: `/v1.43${path}`,
      method,
    };
    const req = http.request(opts, (res) => {
      // parse JSON response
    });
    req.end();
  });
}
```

This is significantly faster and more reliable than spawning `docker ps` and parsing text output. You get structured JSON with all container metadata, stats, and logs.

**Stack discovery** uses Docker labels -- no compose files needed:

```js
const containers = await dockerAPI('GET', '/containers/json?all=true');
const stacks = {};
for (const c of containers) {
  const project = c.Labels['com.docker.compose.project'];
  if (project) (stacks[project] ??= []).push(c);
}
```

Every container created by `docker compose` gets a `com.docker.compose.project` label. Group by that, and you've got stacks.

### 2. An Expo React Native mobile app

Five tabs: Overview, Containers, Stacks, Status, Alerts.

The app connects to any number of Cockpit API instances -- add your production VPS, staging server, and dev box. Switch between them with a tap.

**Real-time updates** via Server-Sent Events (SSE). The API broadcasts system metrics and container state every 15 seconds. SSE is simpler than WebSocket, works over standard HTTP, and auto-reconnects on mobile network changes.

## The security model

This is the part that kept me up at night. You're exposing Docker socket control over a network. The security audit (17 findings, all fixed before launch) shaped these decisions:

**No public ports.** The API container joins your reverse proxy network but exposes zero ports to the internet. Access it via Tailscale, WireGuard, or an IP-restricted reverse proxy.

**Container ID validation.** Without this, a path traversal via crafted container IDs (`../../images/json`) could hit arbitrary Docker Engine API endpoints. Every ID is validated against `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`.

**Self-protection.** The API detects its own container ID at startup and refuses to stop or restart itself. You can't accidentally brick your management plane.

**Dual auth modes:**
- **API key mode**: Single admin, one key. Simple for solo operators.
- **Multi-user mode**: SQLite-backed user accounts with three roles:
  - `viewer` -- read-only dashboards
  - `operator` -- can start/stop/restart containers
  - `admin` -- full control including stack operations and user management

**JWT with refresh tokens**: 15-minute access tokens, 7-day refresh tokens with rotation. Rate limiting: 5 failed attempts = 15-minute lockout.

## Live demo output

Here's what the API returns for a real production server:

### System Overview
```json
{
  "system": {
    "cpuPercent": 5.9,
    "cpuCount": 8,
    "memory": { "percent": 34.49 },
    "disk": { "percent": 13.95 },
    "load": { "load1": 0.71 }
  },
  "containers": { "total": 16, "running": 16, "stopped": 0 },
  "stacks": { "total": 5, "allHealthy": true }
}
```

### SSL Certificates
```json
{
  "certificates": [
    { "domain": "example.com", "daysRemaining": 74, "issuer": "Let's Encrypt" },
    { "domain": "api.example.com", "daysRemaining": 81, "issuer": "Let's Encrypt" }
  ]
}
```

### Endpoint Probes
```json
{
  "endpoints": [
    { "name": "Website", "status": 200, "healthy": true, "responseTime": 102 },
    { "name": "API", "status": 200, "healthy": true, "responseTime": 108 }
  ]
}
```

## Deployment

Drop a single container on your server:

```yaml
services:
  cockpit-api:
    build: .
    container_name: lagoon_cockpit_api
    restart: unless-stopped
    env_file: .env
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /proc:/host/proc:ro
      - cockpit_data:/app/data
    networks:
      - your_proxy_network
    deploy:
      resources:
        limits: { cpus: "0.25", memory: 256M }
```

Set your API key and JWT secret in `.env`, run `docker compose up -d`, and connect from the mobile app.

## What's next

- **EAS builds** for direct APK/IPA distribution
- **Docker image logs streaming** with real-time tail
- **Container resource history** with sparkline graphs
- **Webhook integrations** beyond Expo push notifications

## Try it

MIT licensed, open-source: [github.com/Bigabou007-dev/lagoon-cockpit](https://github.com/Bigabou007-dev/lagoon-cockpit)

If you manage Docker infrastructure and have ever wished you could check on things from your phone without SSH, give it a shot. PRs welcome.

---

*Built by [Lagoon Tech Systems](https://lagoontechsystems.com) in Abidjan, Cote d'Ivoire.*
