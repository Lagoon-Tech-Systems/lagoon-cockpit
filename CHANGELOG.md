# Changelog

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
