# Changelog

## [2.1.0](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/compare/v2.0.0...v2.1.0) (2026-07-12)


### Features

* add app screenshots, fix ContainerCard web nesting, update launch content ([5e8d8e9](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/5e8d8e9b7236e6286cc8f179616e86c7cfae3244))
* add demo GIF to README ([9ae1c45](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/9ae1c45bf583e87c9803da69c5e0be41fe095947))
* add Pro module UI screens and API extensions ([8eccbe6](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/8eccbe697a18549095c71f425bf9994a8b73b812))
* **alerts:** collapse crash-loops into one push via gated RestartCount (C2/G-Gk1) ([60f6cd6](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/60f6cd6a7d505897af2a2fbd0bd8ca67646e84e6))
* **alerts:** GET /api/alerts/events/:id authed single-event read (C3a) ([6b942d3](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/6b942d391edabe57f644783f57d6467a8c9e00c0))
* **alerts:** hysteresis clear-band + debounce to stop boundary re-fires (C2) ([431477c](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/431477cec68f3c7923f89db341aae2a0cfd0a997))
* **alerts:** one info recovery push on resolve + severity via rules API (C2) ([8adfafa](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/8adfafa428566b15bf033d72c04dc3c33a7cd802))
* **alerts:** thread severity through rules, events, and push payload (C2) ([d2cd505](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/d2cd505553fbb6d7cef5b4f6a1aa4daf00ec099c))
* **api:** add getState/setState app_state helpers to history module ([8d0b329](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/8d0b329b41a61494160486aef539a6377b4e8827))
* **api:** add history-query helpers (range/from-to/hours parse, edition clamp, tier select) ([c328dc9](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/c328dc9f0dc622e98308c135961d7debea1a37d8))
* **api:** add scripts/rollback-trends.js per spec §7 (tested) ([753648c](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/753648c2ba1d33753f83c9cc46688ab1f7a8b415))
* **api:** add v3 migration for trend rollup tables and app_state ([31e984d](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/31e984d3d2cea93aea525df65b3eb23c27202064))
* **api:** always-on adaptive metrics sampler decoupled from SSE ([1ec47e9](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/1ec47e909b62e7d105ac3cccae2ef65945477923))
* **api:** arm 5-min rollup interval, boot backfill + catch-up, shutdown clear ([1d0bcbe](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/1d0bcbed0d6d542bb3a531cb492053b05b6489a3))
* **api:** extend GET /api/metrics/history with range/tier-select, edition clamp on every path, and backward-compatible legacy shape ([0a947b7](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/0a947b7d15492bf39893004354cfac00acd372c6))
* **api:** getTrendBuckets reads raw/hourly/daily into uniform bucket shape ([f8585b2](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/f8585b2e67f8d7265bc0e0162b9635749d548126))
* **api:** guarded raw prune deletes only rolled raw, RAW_RETENTION_HOURS=48 ([61e319a](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/61e319a0119e08ea349844d66070bb09300274cc))
* **api:** one-time guarded backfill rolls existing raw into rollups ([35c31a7](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/35c31a7e31759248e8f1b67dbe6fd81f6448aa46))
* **api:** rollupTick folds completed raw buckets into hourly rollups ([d7f2be2](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/d7f2be2c80f8f0d54f9c2d807aadd63c36576ac5))
* **api:** rollupTick folds hourly into sample-weighted daily rollups ([9ec5cbd](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/9ec5cbd09a3d047c5d62d2bfba986a51ca0de2eb))
* **api:** widen getHistorySummary additively with *_min and container aggregates; pin legacy-key snapshot ([10a0301](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/10a03015a807146a28f723cdb08bfc06ff826487))
* **app:** add framework-free trends pill + range logic with tests ([602a064](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/602a06449dd2ed67c0c1c84c36fefd3f5e69fc82))
* **app:** add PWA support + web deployment config ([02c473e](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/02c473e2df49b34c0e70983c7ea617edcfe83ddd))
* **app:** add Trends entry to Manage monitoring menu ([df1aca3](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/df1aca3c5c5333c7f45b7e75dfd8d5954f1f1f67))
* **app:** add Trends screen with range pills and min/max band charts ([2fac908](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/2fac908906c0d077220c07435ce0fdab1f3c546a))
* **app:** add trends store slice with locked-range fetch pre-gate ([054eeab](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/054eeab9d6e20fc0874ecc223df9d9f17aaee862))
* **app:** add typed trends-history contract + band-series mapping ([cba36c2](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/cba36c280d9df3cc69e7ddc512d52698ebba521f))
* **app:** attach res.status to thrown apiFetch errors ([8095281](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/8095281a1c0e36eb40ad4e39457c4b59c0a3c884))
* **app:** create severity Android notification channels at init (C2) ([2ba4115](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/2ba4115244d2ac49b09f767eebd66db8ddec6567))
* **app:** declare iOS Time-Sensitive notification entitlement for critical alerts ([1081e55](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/1081e55b32f2b108baa38b8c2c3d1075d644aa1c))
* **app:** deep-link alert pushes to /events/[eventId] incl. cold start (C3a) ([814bf7f](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/814bf7ffffac61374d6485465bd7d103a3514bc2))
* **app:** mirror metricsRetentionDays limit into client edition map ([d78c4db](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/d78c4dba3608a496195ae2c3db9f11bf84b886ac))
* **app:** verdict-first read-only alert triage screen (C3a/G-S1) ([1c088db](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/1c088dbccfbd9721e1476dfed96174943e9c8157))
* **cockpit:** add LTS monitoring tabs (kaizen-audits, sentinel-live, web-metrics) ([1292aa8](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/1292aa8870b6db879ab453d799b17c7c01a6c911))
* **containers:** expose exitCode/oomKilled in detail read for triage (C3a) ([58611d2](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/58611d2bdc6d725eb0c92d16141947e31916f627))
* **db:** v4 migration — alert severity + hysteresis columns (C2/G-B1) ([ee9e87d](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/ee9e87db4a8c5843985d0277be4018b9c23fe05e))
* **edition:** add metricsRetentionDays limit (CE 30 / Pro 365) ([9e569e5](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/9e569e5d0900ea2a3dd8d4bcc0fd5d53c5581646))
* **edition:** add resolveRetentionDays fail-closed by edition name ([f3c41c0](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/f3c41c0f504828645144d366d45a557de69d2b59))
* **edition:** raise CE metrics retention floor 30d-&gt;90d (board-ratified) ([327754c](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/327754ce35b74dc77495c695a4bf47c31d65bd94))
* **push:** map severity to Expo interruptionLevel/channel/sound (C2) ([36d827f](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/36d827f4f20e36c25e50d7da1d51324ffc66d31c))
* **push:** optional per-user recipient scoping seam (C0/G-P1) ([88b7a63](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/88b7a63f80afb925391b78c2eb9d3b5a5dd012c2))
* **push:** per-token rolling-window push budget to prevent self-DoS (C0/G-P1) ([53fc81e](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/53fc81e2a6bd70b8c5ab9cd48bdcca30d6b1bc86))
* **security:** throttle destructive container/stack routes with strictLimiter (G-P2) ([6723818](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/67238182b8e94fa06be52c19b4c2e8660115a466))
* surface AGPL §13 Corresponding-Source offer to network users ([04dc49c](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/04dc49c33e9ab47eadbb5e784f46c43b3093012a))


### Bug Fixes

* **alerts:** cold-start baseline seeding to prevent boot-time alert storm (C0/G-T1) ([5302e41](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/5302e417d164cee6b3a43fcd89d46471345c9aa6))
* **alerts:** evaluate rules + detect container state in the always-on sampler (C0) ([5ee483c](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/5ee483c72b9eeaacc060e87812065e14c1b1e9f4))
* **alerts:** honor maintenance mode in the always-on sampler eval path (C0/G-T1) ([12f9f0e](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/12f9f0eebd39ccc772d76a76c4bd0fe1534818c0))
* **alerts:** isolate sampler stages + severity-aware push budget (final review I1/I2) ([96c5603](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/96c5603e49010d38f77956c27b8cec9e1d345bd3))
* **alerts:** restore SSE alert broadcast + unconditional state_change webhook parity (C0 review) ([b7c596e](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/b7c596e9d08985036d0a33e07514424e7c649a48))
* **api:** backfill guard reads passed connection + epoch-0 lower-bound sentinel ([d683b77](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/d683b77cebdba6f993d1e74efc389cf008743445))
* **api:** bound legacy hours to [1,730] days + normalize parseRequest shape ([9313e8a](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/9313e8af800d27bfb643bf64ebb820b2c1f347db))
* **api:** clear history.js raw-prune interval on shutdown (no handle leak) ([1b1e632](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/1b1e632a38338c77dabcddc18c850ad5b4573ad2))
* **api:** coerce non-finite metrics to null in recordMetrics ([3465fb0](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/3465fb0fc8446a8619ab22f587b87e09849d73b9))
* **api:** enforce MAX_POINTS cap, discriminating paywall tests, served-window summary ([3467bec](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/3467beca57a212ea2c98e613e300244a442ba7ed))
* **api:** legacy hours&gt;48 summary covers served window, not just 48h raw ([47852e6](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/47852e6c2b3642dbad465caf2b25429e2c296ba1))
* **api:** thread db connection through app_state helpers so rollup watermark is transaction-atomic ([d177432](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/d177432be1f338c1b5bf6c251328a5e48f1176ec))
* **app:** align 12 packages to SDK 55 expected versions (fixes EAS gradle Kotlin compile) ([6827186](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/68271868a0736a3a434c12de09bbbb913ca43429))
* **app:** guard trends chart helpers + accurate band-hint label ([e546ce8](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/e546ce840351135d7168f275effd142ba7a3d41e))
* **build:** hoist expo to workspace root so hoisted config plugins resolve expo/config-plugins (fixes EAS READ_APP_CONFIG silent exit 1) ([4ac9aba](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/4ac9abaecb01d09e15eec131e9943d745069ca44))
* **build:** regenerate root lockfile with npm 10 so EAS npm ci sync-validation passes on both npm 10 and 11 ([14c1b12](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/14c1b1248dfdd93fd2e03de4969770b00494cf75))
* **build:** resolve expo SDK drift — drop redundant root deps, legacy-peer-deps, single expo@55 tree (fixes EAS bundling + doctor duplicate-module failures) ([6e19969](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/6e19969b2b131d42371f861095e66a98b8d665ff))
* correct license from MIT to AGPL-3.0 in launch Dev.to article ([c90700e](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/c90700e79b84d589ed20b0079be941e709a6216b))
* correct license from MIT to AGPL-3.0 in launch LinkedIn post ([c10b491](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/c10b491c561778abc1c2b2533c08d2891842761c))
* correct license to AGPL-3.0, redact real stack names from content Dev.to article ([5b36924](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/5b3692430f56363c96951b72a4db9cb110eafa0a))
* correct license to AGPL-3.0, remove MT5 trading reference from content LinkedIn post ([e27783c](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/e27783cf585816e46cc2532ee3892c33882cc296))
* **metrics:** preserve sub-day from/to windows so fresh-alert triage charts get raw tier ([1ab7594](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/1ab759458d1c1686ab31d5dee0ec3da1b2e3c6b7))

## [Unreleased]

### Security

- **api:** type-check `q`/`regex`/`context` on `/api/containers/:id/logs/search` so duplicate query params cannot bypass the ReDoS heuristic (closes CodeQL #99).
- **api:** cap `SAMLResponse` at 100KB base64 / 200KB decoded XML on the SSO ACS endpoint before the comment-strip regex runs, bounding polynomial regex work (closes CodeQL #14).
- **api:** length-check email at RFC 5321 max (254) before the subscriber email regex (closes CodeQL #15).
- **api:** endpoint-probe TLS now validates peer certificates by default; set `STRICT_TLS=false` to opt into the previous permissive behavior (closes CodeQL #26, posture hardening per board review on PR #48).
- **windows-agent:** add `safe_error()` helper and `@app.errorhandler(Exception)` global catch so service/process/MT5 routes never leak Python tracebacks (closes 11× CodeQL py/stack-trace-exposure).
- **windows-agent:** `sanitize_upstream()` now uses an explicit allowlist (`MT5 Bridge unreachable`, `MT5 Bridge timed out`, `MT5 Bridge error`); any other upstream `error` field is replaced with a generic message (closes the short-string-evasion gap raised by the board review on PR #48).
- **api:** bump `uuid` pin to `^13.0.1` (closes Dependabot GHSA-w5hq-g745-h8pq for the direct dependency; deep dev-only transitives via `@expo/ngrok` and `xcode` remain on legacy versions and are not on a reachable path).
- **triage:** 84 CodeQL warnings were dismissed with written reasons that link back to `SECURITY-TRIAGE.md`. The ledger documents the `globalLimiter` floor, the SAML signature-verification security boundary, and the API-key-fingerprint-not-password-hash architecture so future contributors can re-evaluate the rationale rather than read silent suppressions.

### Tests

- **api:** new `__tests__/codeql-guards.test.js` locks the type-check, size-cap, email-cap, and STRICT_TLS guards against silent removal.
- **windows-agent:** new `tests/test_sanitize_upstream.py` covers the allowlist behavior (short `ValueError` and `pymysql.OperationalError`-style messages with embedded IPs/usernames are masked).

### Docs

- New `SECURITY-TRIAGE.md` ledger.
- Operations entry for `lagoon-cockpit` added to the internal `lts-pre-deploy` matrix, documenting the canonical `packages/api/`-rooted compose layering and the known root-`docker-compose.yml` / `scripts/deploy.sh` drift.

## [2.0.0](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/compare/v1.0.0...v2.0.0) (2026-03-30)


### ⚠ BREAKING CHANGES

* Pro and Enterprise mobile screens removed from CE public repo. These now live exclusively in the private cockpit-pro repository. CE manage menu shows only CE features (14 items).

### Features

* **app:** add 11 Pro mobile screens + fix API paths and FeatureGate coverage ([0c4a207](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/0c4a2077165e8623a63fd4377aed70498c368373))
* **app:** add 19 Enterprise mobile screens, migrate animations to Reanimated v4 ([3f0d670](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/3f0d6707c1ec4ff375f48c26d34da6f8e5ce499b))
* Pro UI — incidents management + auto-remediation screens ([16ebefb](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/16ebefb44311ecacd616c2c3877f0fe8b6b8bbcb))
* publish lagoon-cockpit-cli to npm, enable CI publish job ([5043143](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/504314335a9073d855b79be205c9c25b0709bb05))
* separate CE and Pro editions, rotate all secrets ([33a8716](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/33a87164570897d9d510c8b5b75a26db0c3be91a))


### Bug Fixes

* **app:** resolve Reanimated AnimatedStyle type mismatch in Skeleton ([2f07d43](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/2f07d43f37b88c65d0ac9d8692b90532ece2fe93))
* **app:** resolve Skeleton style type mismatch for Reanimated ([4c65f51](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/4c65f5192d22d81fefe8e0e8c2c4352c38f50a93))
* **app:** sanitize error messages, complete Reanimated v4 migration, wire compliance nav + IP edit ([b79db89](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/b79db894b3292955115face8e1edf9437c217b8c))
