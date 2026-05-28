# Security Triage Ledger

This file tracks the CodeQL alert dispositions for lagoon-cockpit so dismissals are auditable, distinguishable from rubber-stamp, and re-litigatable when assumptions change.

The ledger pairs with the GitHub Security tab and the `gh api code-scanning/alerts` history. Every dismissal in this repo links back to a rationale here.

## Conventions

- **Code fix** — alert closed by a code change. Listed with the PR number.
- **Dismissed: false positive** — analyzer is wrong about the code; rationale must explain why.
- **Dismissed: won't fix** — analyzer is right but the cost of fixing outweighs the risk in our threat model; rationale must name the compensating control or tracking issue.
- **Dismissed: not used** (Dependabot only) — vulnerable code path not reachable.

If the rationale for any dismissal stops being true (e.g. `globalLimiter` is removed, signature verification is bypassed), the alert must be reopened.

## Architecture: `globalLimiter` is the rate-limit floor

70 CodeQL `js/missing-rate-limiting` warnings were dismissed across 2026-05-28 with one identical reason. The reason hinges on a single line of code:

```js
// packages/api/src/index.js:74
app.use(globalLimiter);
```

`globalLimiter` is created in `packages/api/src/security/rate-limiter.js` as a sliding-window limiter (default 100 req/min per IP, in-memory store with a Redis adapter available). Because it is mounted via `app.use` at the application root **before any route**, every request that reaches an Express handler has already been counted. CodeQL's `js/missing-rate-limiting` rule does not trace `app.use`-applied middleware, so it flags every per-route handler as if no limiter existed.

In addition to the global floor:

- `rateLimitAuth` is applied to `/auth/token`, `/auth/login`, `/auth/refresh` (stricter — IP lockout on failed attempts).
- The SSO ACS endpoint (`packages/api/extensions/cockpit-enterprise/sso/routes.js`) has its own `checkAcsRateLimit` (10/min/IP).

Each of the 70 dismissals references this section. If `globalLimiter` is ever removed, refactored, or moved after a sub-router that bypasses it, all 70 alerts must be re-evaluated.

**Known limitation:** 100 req/min/IP on `/auth/token` is loose for brute force (PR #48 board review, Piccolo + Bulma). Until a per-route auth-tier override lands, the dismissal rationale holds for the design intent but is conceded as soft on the auth surface.

## Architecture: SAML signature is the SSO security boundary

8 CodeQL `js/incomplete-multi-character-sanitization` warnings on `packages/api/extensions/cockpit-enterprise/sso/routes.js` were dismissed as `won't fix`. The reason: the regex-based XML comment stripping is **defense-in-depth**, not the security boundary. The security boundary for SAML assertions is the XML signature verified at `verifySamlSignature()` (line 169).

The signature is computed over the canonicalised `SignedInfo` block. If an attacker tampers with the assertion content — including by injecting XML comments to confuse the comment-strip regex — the signature verification will fail and the assertion is rejected.

PR #48 added a 100KB base64 / 200KB decoded-XML cap on the ACS endpoint to bound the polynomial regex work on the comment-strip pass (closes the polynomial-redos alert in the same module). With the cap in place, the worst-case attacker scenarios for the regex are:

1. **DoS** — bounded by the size cap and the SAML ACS endpoint's own `checkAcsRateLimit` (10/min/IP).
2. **Issuer extraction before signature verification** — the regex extracts `Issuer` from the unverified XML to know which IdP's certificate to use for verification. This is fundamental SAML architecture; the extracted Issuer is used only as a parameterized DB lookup key, not executed. The extraction regex (`extractXmlElement`) is linear (`[^<]+` and `[^>]*` have no nested quantifiers), so it is not itself ReDoS-vulnerable.

The real fix is to replace the regex extraction with an XML parser (`@xmldom/xmldom`). Tracked as **[#49 — replace SAML regex extraction with xmldom](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/issues/49)**.

## Architecture: API key fingerprint, not password hash

3 alerts (`js/insufficient-password-hash` × 1, `py/weak-sensitive-data-hashing` × 2) on `packages/api/src/auth/keys.js:10` and `packages/windows-agent/auth/keys.py:11-12` were dismissed as false positives.

These functions hash a **single static high-entropy API key** (64-hex random secret, set via `API_KEY` env) so that `crypto.timingSafeEqual` / `hmac.compare_digest` can run on equal-length buffers regardless of input length. The hash is computed on **both sides** of the comparison and never persisted to disk. SHA-256 is a sound choice here:

- Input domain is `{API_KEY}` — one value, not a user-chosen password.
- Pre-image attack is moot because there's nothing to discover (the attacker would already need the secret to land in this code path).
- Argon2/bcrypt would add 100ms+ of CPU per auth attempt with zero security gain.

If the auth model ever shifts to user-chosen passwords stored at rest, these alerts must be reopened and the implementation migrated to Argon2id.

## Acknowledged residual risks

Items the board review surfaced that are NOT closed by PR #48's code changes and are NOT dismissed. They are accepted-with-rationale until tracked work moves them.

| Risk | Owner | Tracking issue |
|---|---|---|
| `rateLimitAuth` per-route threshold for `/auth/token` not tighter than `globalLimiter` (100/min/IP) | open | _file follow-up_ |
| SAML regex extraction not replaced with a proper XML parser | open | [#49](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/issues/49) |
| Search regex on `/api/containers/:id/logs/search` not migrated to `re2` (linear-time) | open | [#50](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/issues/50) |
| `STRICT_TLS=false` opt-out for endpoint probes still possible (default flipped to `true` in this PR) | open | [#51](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/issues/51) (revisit on 2026-08-29) |

## Reopening discipline

If you reopen any alert dismissed here, append a line under the alert in this file with the date, the reason, and the new disposition. Do not silently re-dismiss.

## Change log

- **2026-05-29** — initial ledger created as part of PR #48 follow-up; 84 dismissals + 16 fixes from 2026-05-28 documented above.
