# Lagoon Cockpit — Live API Demo Output

> Example responses from a production server running 16 Docker containers across 5 Compose stacks.

---

## Health Check

```
GET /health
```

```json
{
  "status": "ok",
  "timestamp": "2026-03-19T08:01:43.186Z"
}
```

Unauthenticated. Used by Docker healthcheck and load balancers.

---

## System Overview

```
GET /api/overview   (requires Bearer token)
```

```json
{
  "serverName": "My Server",
  "system": {
    "cpuPercent": 5.9,
    "cpuCount": 8,
    "memory": {
      "total": 25199222784,
      "used": 8691142656,
      "percent": 34.49
    },
    "disk": {
      "total": 414921494528,
      "used": 57860964352,
      "percent": 13.95
    },
    "load": { "load1": 0.71, "load5": 0.47, "load15": 0.55 },
    "uptimeSeconds": 284383
  },
  "containers": {
    "total": 16,
    "running": 16,
    "stopped": 0,
    "unhealthy": 0
  },
  "stacks": {
    "total": 5,
    "allHealthy": true
  }
}
```

Single call gives you CPU, RAM, disk, load average, uptime, and container/stack health summary.

---

## Containers

```
GET /api/containers   (requires Bearer token)
```

Returns all containers with status, image, health, compose project, ports, and networks:

| Container | State | Stack |
|-----------|-------|-------|
| cockpit_api | running | api |
| web_app | running | website |
| postgres_db | running | website |
| reverse_proxy | running | proxy |
| workflow_engine | running | automation |
| search_engine | running | (standalone) |
| cloud_app | running | cloud-suite |
| cloud_db | running | cloud-suite |
| cloud_cache | running | cloud-suite |
| ... | running | cloud-suite |

Each container includes full detail: image tag, ports, health status, labels, network mode, and size.

---

## Docker Compose Stacks

```
GET /api/stacks   (requires Bearer token)
```

Stacks are auto-discovered from Docker labels -- no config files needed:

| Stack | Status | Containers |
|-------|--------|------------|
| api | running | 1 (1 up, 0 down) |
| website | running | 2 (2 up, 0 down) |
| cloud-suite | running | 10 (10 up, 0 down) |
| automation | running | 1 (1 up, 0 down) |
| proxy | running | 1 (1 up, 0 down) |

Each stack includes its full container list with per-container status.

---

## SSL Certificates

```
GET /api/ssl   (requires Bearer token)
```

```json
{
  "certificates": [
    {
      "domain": "example.com",
      "valid": true,
      "daysRemaining": 74,
      "expiresAt": "2026-06-01T17:08:22.000Z",
      "issuer": "Let's Encrypt"
    },
    {
      "domain": "api.example.com",
      "valid": true,
      "daysRemaining": 81,
      "issuer": "Let's Encrypt"
    },
    {
      "domain": "app.example.com",
      "valid": true,
      "daysRemaining": 73,
      "issuer": "Let's Encrypt"
    }
  ]
}
```

Checks actual TLS certificates via socket connection. Color-coded in the mobile app: green (>14d), yellow (7-14d), red (<7d).

---

## HTTP Endpoint Probes

```
GET /api/endpoints   (requires Bearer token)
```

```json
{
  "endpoints": [
    { "name": "Website", "url": "https://example.com", "status": 200, "healthy": true, "responseTime": 102 },
    { "name": "API", "url": "https://api.example.com", "status": 200, "healthy": true, "responseTime": 108 },
    { "name": "App", "url": "https://app.example.com", "status": 200, "healthy": true, "responseTime": 1602 }
  ]
}
```

Probes each endpoint and returns HTTP status code + response time in milliseconds.

---

## Resource Footprint

The entire API runs in a single container:

| Metric | Value |
|--------|-------|
| Memory usage | 22 MB / 256 MB limit |
| CPU usage | ~0% at idle |
| Image size | ~120 MB (node:20-alpine + deps) |
| Dependencies | 5 npm packages |
| Startup time | < 2 seconds |

---

*Captured from a live VPS running Ubuntu 24.04.*
