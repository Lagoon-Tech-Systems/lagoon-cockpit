# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| Latest  | Yes                |
| < 1.0   | No                 |

## Reporting a Vulnerability

If you discover a security vulnerability in Lagoon Cockpit, please report it responsibly.

**Email**: security@lagoontechsystems.com

**Alternative**: Use [GitHub Security Advisories](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/security/advisories/new) to report privately.

### What to include

- Description of the vulnerability
- Steps to reproduce (including environment details)
- Potential impact and severity assessment
- Suggested fix (if any)
- Whether you want to be credited in the advisory

### Response timeline

| Severity | Acknowledgment | Fix target | Public disclosure |
|----------|---------------|------------|-------------------|
| Critical | 24 hours      | 7 days     | After fix shipped  |
| High     | 48 hours      | 14 days    | After fix shipped  |
| Medium   | 72 hours      | 30 days    | After fix shipped  |
| Low      | 1 week        | Next release | After fix shipped |

### CVE process

For confirmed vulnerabilities, we will:
1. Assign a CVE identifier via GitHub Security Advisories
2. Develop and test a fix in a private branch
3. Release the fix with a security advisory
4. Credit the reporter (unless they prefer anonymity)

## Security Architecture

Lagoon Cockpit is designed for managing production infrastructure. Security is built into every layer:

### Authentication & Authorization
- JWT access tokens (15-minute TTL) with unique `jti` for revocation
- One-time-use refresh token rotation (prevents token replay)
- SQLite-backed refresh tokens (persist across restarts)
- Fingerprint binding (optional IP/UA verification)
- RBAC: admin, operator, viewer roles
- Constant-time API key comparison (prevents timing attacks)
- IP-based brute-force protection (5 attempts, 15-minute lockout)

### API Security
- Helmet security headers (CSP, HSTS, X-Frame-Options, noSniff)
- Strict CORS with origin allowlist (no wildcard in production)
- Sliding-window rate limiting (global + per-endpoint)
- JSON Schema request body validation on all mutation endpoints
- X-Request-ID tracing on every request
- Enhanced audit logging (IP, user-agent, request fingerprint)
- HTTPS enforcement (`FORCE_HTTPS=true`)

### Container Security
- Multi-stage Docker build (no build tools in runtime image)
- Non-root user (`node`)
- Resource limits (0.25 CPU, 256MB RAM default)
- Health check endpoint
- Docker socket access via group (not root)

### Data Security
- SQLite with WAL journaling and foreign key constraints
- Credentials stored in `expo-secure-store` (iOS Keychain / Android EncryptedSharedPreferences)
- No telemetry, analytics, or crash reporting by default
- All data stored on user's own infrastructure
- License keys validated offline (no phone-home)

### Supply Chain
- GitHub Actions pinned to commit SHAs (exception: `expo/expo-github-action`, pinned to a major tag)
- TruffleHog secret scanning on every push
- npm audit on every CI run
- Container scanning with Trivy (nightly)

## Please do NOT

- Open a public GitHub issue for security vulnerabilities
- Exploit the vulnerability beyond what is necessary to demonstrate it
- Access or modify other users' data
- Perform denial of service attacks
