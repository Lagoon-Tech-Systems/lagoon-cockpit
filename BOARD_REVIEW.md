# Board Review — Lagoon Cockpit v3.1

**Date**: 2026-03-27
**Reviewers**: Piccolo (Security), Bulma (Architecture), Trunks (Infrastructure), Goku (Backend), Smeargle (UI/UX)
**Mode**: Read-only audit — no files modified
**Codebase**: 91 source files, 13,929 lines, 4 packages

---

## Scores

| Member | Role | Score | Verdict |
|---|---|---|---|
| Trunks | Infrastructure | **10/10** | All 10 checks PASS |
| Bulma | Architecture | **8.5/10** | Clean architecture, zero TS errors, zero API vulns |
| Goku | Backend | **7.5/10** | Solid patterns, 2 items need attention |
| Smeargle | UI/UX | **7.5/10** | Core screens polished, secondary screens need consistency |
| Piccolo | Security | **PASS** | 1 FAIL (SIGTERM), 2 advisories |

---

## Consensus Finding

All three technical reviewers (Piccolo, Goku, Bulma) independently flagged the same issue: **the SIGTERM handler got lost during route extraction.** The `closeAllClients()` function exists in `sse.js` but nothing calls it. This is the only blocking item before the next release.

---

## Issue List

| # | Severity | Issue | Flagged By | Details |
|---|---|---|---|---|
| 1 | **MUST-FIX** | SIGTERM handler missing | Piccolo, Goku, Bulma | No `process.on('SIGTERM')` in index.js. On container stop, SSE clients hang and SQLite WAL may not checkpoint. The `closeAllClients()` exists in sse.js but is never invoked. Fix: store `app.listen()` return value, add signal handler that calls `server.close()`, `closeAllClients()`, clears broadcast interval. |
| 2 | **SHOULD-FIX** | `METRICS_TOKEN` not set in production .env | Piccolo | The `/metrics` Prometheus endpoint falls back to unauthenticated when `METRICS_TOKEN` is not configured. Currently unset in the live .env file, so /metrics is open to any caller on the Docker network. Fix: add `METRICS_TOKEN=<random>` to .env. |
| 3 | **SHOULD-FIX** | SSE `broadcast()` has no write error handling | Goku | `client.write(payload)` in sse.js has no try/catch. A broken pipe on a disconnected client could emit an unhandled `error` event and crash the process. Fix: wrap in try/catch or add `.on('error')` handler per client. |
| 4 | **SHOULD-FIX** | 5 routes lack try/catch | Goku, Bulma | `DELETE /api/alerts/rules/:id`, `PUT /api/alerts/rules/:id/toggle`, `DELETE /api/webhooks/:id`, `DELETE /api/schedules/:id`, `DELETE /auth/users/:id` — if the underlying SQLite call throws, these return raw stack traces. Fix: wrap in try/catch with `safeError()`. |
| 5 | **SHOULD-FIX** | 8 components + status.tsx still hardcode colors | Bulma, Smeargle | `status.tsx`, `StackCard.tsx`, `StatusBadge.tsx`, `ActionSheet.tsx`, `ServerPicker.tsx`, `LogViewer.tsx`, `MetricGauge.tsx`, `Sparkline.tsx` — ~80 hardcoded hex values instead of importing from `tokens.ts`. Creates palette drift risk. |
| 6 | **SHOULD-FIX** | ~30 emoji icons in manage screens | Smeargle | `manage.tsx` (12 menu items), `monitoring.tsx` (refresh/error), `activity.tsx`, `maintenance.tsx`, `networks.tsx`, `images.tsx`, `disk.tsx` — all use Unicode emoji instead of `@expo/vector-icons`. Inconsistent with polished tab screens. |
| 7 | **SHOULD-FIX** | README missing Prometheus/Grafana docs | Bulma | `/metrics` endpoint, `METRICS_TOKEN` env var, Grafana monitoring screen, and manage screen count (now 11, not 10) are undocumented. |
| 8 | **LOW** | Monitoring refresh button below 44pt | Smeargle | `monitoring.tsx` refresh button is 36x36. Should be `minWidth: 44, minHeight: 44`. |
| 9 | **LOW** | ReDoS pattern check incomplete | Piccolo, Goku | Log search regex blocklist catches `(a+)+` but misses `(a\|a)+` and `(a+){2,}`. The 200-char length cap is the real safety net. Consider `safe-regex2` or worker thread with timeout in a future pass. |
| 10 | **LOW** | Skeleton/animations missing on stacks + alerts | Smeargle | Overview and containers have skeleton loading + entry animations. Stacks and alerts do not. Minor consistency gap. |

---

## What's Working Well

### Infrastructure (Trunks — 10/10)
- Container healthy, 0 restarts, resource-limited (0.25 CPU / 256MB)
- HTTPS on both endpoints (Linux + Windows) with Let's Encrypt
- Port 3000 NOT publicly exposed — internal Docker network only
- Daily backups at 3 AM with cron, first backup verified
- Sentinel monitoring both endpoints + SSL + container presence
- CI pipeline: TruffleHog secret scanning + npm audit + pinned SHAs
- Dockerfile: non-root user, healthcheck, minimal Alpine image

### Architecture (Bulma — 8.5/10)
- index.js reduced from 911 to 115 lines — 6 clean route modules
- TypeScript: zero errors with strict mode
- API: zero npm vulnerabilities
- Token system well-designed, adopted on all primary screens
- Prometheus endpoint follows correct exposition format
- Grafana WebView dual-platform (native + web) with kiosk mode

### Backend (Goku — 7.5/10)
- 57 routes across 6 modules, all authenticated (except /health and /metrics)
- 100% parameterized SQLite queries — zero SQL injection vectors
- Exec whitelist: exact match only, argv execution, metachar blocking
- Scheduler: double-fire prevention via minute-key dedup, 50 schedule cap
- Windows agent: 45 Flask routes with full stub coverage for mobile app compatibility
- Service protection whitelist prevents stopping critical Windows services

### Security (Piccolo — PASS)
- All previous audit findings still fixed (exec, SSRF, container ID, self-protection)
- No secrets in git history — TruffleHog CI confirms
- .env properly gitignored, never committed
- No hardcoded IPs, passwords, or tokens in source
- Grafana WebView: no credential exposure in URLs
- JWT with refresh token rotation, timing-safe key comparison
- Rate limiting on auth: 5 attempts then 15-minute lockout

### UI/UX (Smeargle — 7.5/10)
- Shared design token system (14 colors, radius, spacing, typography)
- Vector icons (Ionicons) on all primary tab screens
- Skeleton shimmer loading on overview + containers
- Staggered entry animations on overview + containers
- Haptic feedback on all container start/stop/restart actions
- 44pt minimum tap targets on critical interactive elements
- Error states with retry buttons on overview, containers, stacks
- Dark theme cohesive where tokens are used

---

## Recommended Fix Priority

### Before next release
1. Re-add SIGTERM handler to index.js
2. Set `METRICS_TOKEN` in production .env

### Next sprint
3. SSE broadcast write safety (try/catch on client.write)
4. Wrap 5 remaining routes in try/catch
5. Migrate 8 component files to tokens
6. Replace ~30 emoji with vector icons
7. Add Prometheus/Grafana section to README

### Backlog
8. Fix monitoring refresh button tap target
9. Upgrade ReDoS protection (safe-regex2 or worker timeout)
10. Add skeleton/animations to stacks + alerts tabs

---

## Production Status

| System | Status |
|---|---|
| Linux API (`lagoon_cockpit_api`) | Running, healthy, 0 restarts |
| Windows Agent (`pythonw.exe`) | Running, port 3001 listening, auto-start on boot |
| HTTPS (Linux) | `cockpit.lagoontechsystems.com` — responding |
| HTTPS (Windows) | `cockpit-win.lagoontechsystems.com` — responding |
| Prometheus | 37 metrics at `/metrics` — live |
| Backups | Daily 3 AM cron — last: 2026-03-27 |
| Sentinel | Monitoring both endpoints + SSL + container |
| CI/CD | GitHub Actions: audit + test + secret scan |
| GitHub | https://github.com/Lagoon-Tech-Systems/lagoon-cockpit |
| Dev.to | Published, updated to v3 |
