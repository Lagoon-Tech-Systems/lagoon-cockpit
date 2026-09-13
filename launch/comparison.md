# "From your phone" comparison — DRAFT (for README + launch post)

> Every row below was verified against the competitors' current docs/repos during the
> 2026-06 competitive scan (board run wf_1ff22f06). Re-verify before publishing if >30 days old.
> Rules: no pricing, no unverifiable claims, generous to competitors where they're genuinely good.

| At 2am, from your phone… | **Lagoon Cockpit** | Portainer | Beszel | Uptime Kuma | Dozzle |
|---|---|---|---|---|---|
| Native mobile app | ✅ Android + web PWA (iOS in pipeline) | ❌ web only | ✅ iOS + Android | ❌ (3rd-party apps) | ❌ web only |
| Push when a container dies — app closed | ✅ server-side eval, 24/7 | ❌ webhooks to other tools | ✅ | ✅ via notification services | ❌ |
| Severity levels + quiet channels | ✅ info/warn/critical → Android channels | ❌ | ⚠️ threshold alerts, no severity tiers | ⚠️ per-monitor, no severity model | ❌ |
| Alert de-noise (hysteresis + crash-loop collapse) | ✅ built-in, on by default | ❌ | ❌ | ⚠️ manual retries setting | ❌ |
| Tap alert → triage screen (trend + threshold + top consumers) | ✅ | ❌ | ❌ (dashboards, no alert-anchored view) | ❌ | ❌ |
| "✓ resolved" notification | ✅ | ❌ | ✅ | ✅ | ❌ |
| Manage containers (start/stop/restart/logs) | ✅ | ✅ (desktop) | ❌ monitoring only | ❌ | ⚠️ logs only |
| Interactive shell into a container | ⚠️ **no** — 18 fixed read-only diagnostics only | ✅ console | ❌ | ❌ | ❌ |
| Metric history | ✅ tiered rollups, up to 2y | ⚠️ basic | ✅ | ⚠️ uptime history | ❌ |
| License | AGPL-3.0 | BSL/EE mix (CE exists) | MIT | MIT | MIT |

**What the others do better (say it in the post if asked — credibility):**
- **Beszel** is lighter and simpler if you only want monitoring + alerts — genuinely good, and its mobile app is free.
- **Portainer** has far deeper cluster/K8s management on desktop.
- **Uptime Kuma** has 90+ notification integrations; Cockpit has push/webhooks/Telegram-Slack (Pro).
- **Dozzle** is the best pure log-tailing experience.

Cockpit's claim is narrow and specific: **it's the only one that closes the whole loop on the phone** — woken correctly (severity + de-noise), shown what broke (alert-anchored triage), told when it's over (resolve push), and able to act (restart/stop/logs) without a laptop.

Note on the shell row: Cockpit deliberately ships an exact-match allowlist of 18 read-only
diagnostic commands (`pg_isready`, `df -h`, `ps aux`, …) rather than an interactive shell. That is
a real capability gap against Portainer's console, not a wording choice — say so plainly if asked.
