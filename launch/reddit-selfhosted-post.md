# r/selfhosted launch post — DRAFT (owner reviews + posts manually)

> Title options (pick one):
> 1. Lagoon Cockpit — self-hosted Docker dashboard built for the 2am page: alert fires on your phone, one tap shows you what broke (AGPL)
> 2. I got tired of opening my laptop at 2am to find out why a container died, so I built a mobile-first Docker cockpit (AGPL, self-hosted)

---

**Body:**

Portainer is great, but it lives on a desktop browser. When a container dies at 2am, my actual workflow was: phone buzzes (if anything buzzes at all) → get up → open the laptop → VPN in → dig through three screens to find out it was a crashed container that needed one restart.

Lagoon Cockpit is a self-hosted, mobile-first Docker dashboard I've been building to kill that workflow. This week's release finally closes the loop I originally promised myself:

**The 2am loop:**
- A lightweight API agent runs next to your containers. Alert rules (CPU / memory / disk / load / container-down) are evaluated server-side, around the clock — **your phone gets the push even when the app hasn't been opened in days** (embarrassing honesty: until this release, alerts only evaluated while a dashboard was actually open — that's fixed and regression-tested).
- Alerts have **severity levels** (info / warn / critical) mapped to real Android notification channels, with **hysteresis** so a metric bouncing around your threshold doesn't re-page you every 15 minutes, and **crash-loop collapsing** so a container stuck in a restart loop is one notification ("🔁 web-api crash-looping — 6 restarts in 4 min"), not six.
- **Tap the notification → a triage screen** for that exact alert: what fired and when, the metric's trend with your threshold drawn on it, and the current top-consuming containers (labeled "not necessarily the cause" — it's a hint, not an accusation).
- When the alert resolves, you get one "✓ resolved" push instead of wondering.

**The rest of it** (been building for a while): container/stack management (start/stop/restart/exec/logs), live dashboards over SSE, metric history with tiered rollups (up to 2 years), SSL & endpoint monitoring, scheduled actions, webhooks, multi-server, biometric app lock, CLI companion.

**Honest limitations, because this sub can smell marketing:**
- Push delivery is best-effort (Expo/FCM/APNs) — it's a monitoring tool, not a paging SLA.
- iOS exists but Time-Sensitive delivery is still going through the native-build pipeline; Android is the first-class citizen today.
- The alert engine samples every 15s (60s when idle) — detection latency is "under a minute", not "instant".
- Solo project. AGPL-3.0. The paid tiers fund development but the entire alert/triage loop above is in the free CE core.

**Stack:** Node/Express API next to your Docker socket (read-only-hardened container, no new public ports — designed to sit behind your reverse proxy or Tailscale), React Native/Expo app + web PWA.

GitHub: https://github.com/Lagoon-Tech-Systems/lagoon-cockpit

Would genuinely love this sub's take on the alert semantics (hysteresis defaults, severity mapping) — that's the part I've rewritten the most.

---

> **OWNER CHECKLIST before posting:**
> - [ ] Record the real demo GIF on the phone (push arrives → tap → triage screen) and put it in the README first — the post should link a README that shows the loop.
> - [ ] Verify the GitHub README front page reflects the new release (alerts section + comparison).
> - [ ] Post from personal Reddit account; engage comments for the first 2-3 hours (r/selfhosted decides in the first hour).
> - [ ] Do NOT mention Pro/Enterprise pricing (deferred by board decision 1a2f98a9) — if asked, "paid tiers exist for operational features; CE has the full loop above."
