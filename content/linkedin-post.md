# LinkedIn Post — Lagoon Cockpit v3 Update

---

One week ago I open-sourced Lagoon Cockpit -- a mobile DevOps dashboard.

Since then it went from "monitor Docker containers" to a full cross-platform infrastructure command center. Here's what shipped in v3:

**Windows Server support.** Same app, second server profile. Monitor Windows Services, processes, and system resources -- all from your phone next to your Docker containers.

**23 API endpoints on Linux. 15 on Windows.** Container exec with a security-hardened command whitelist. Regex log search. Bulk operations. Nuke & rebuild. Scheduled cron actions. Custom alert rules. Webhook integrations.

**A visual system map** that shows your entire Docker topology -- stacks grouped, networks connected, health color-coded. Tap any node to manage it.

**A CLI companion** with 20 commands. `cockpit ps`, `cockpit logs`, `cockpit exec` -- everything the mobile app does, from your terminal.

**35 security findings fixed** across 2 full audits before going public. Shell injection prevention, SSRF protection, rate limiting, role-based access control.

10,000+ lines across 4 packages. AGPL-3.0 licensed. Running in production right now.

The goal was simple: manage your servers from your phone without SSH. We went a bit further than that.

https://github.com/Lagoon-Tech-Systems/lagoon-cockpit

#OpenSource #DevOps #Docker #ReactNative #InfrastructureMonitoring #SelfHosted
