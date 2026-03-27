# LinkedIn Post — Lagoon Cockpit v3 Launch

---

Just shipped **Lagoon Cockpit v3** -- an open-source mobile DevOps command center for your entire infrastructure.

The problem: you're on the go, something goes down, and your only options are SSH from a phone keyboard or a Telegram alert you can't act on.

Lagoon Cockpit gives you a native mobile app that connects to lightweight agents running on each server -- Linux or Windows. From your phone you can:

- Monitor CPU, RAM, disk across multiple servers at a glance
- Manage Docker containers and Compose stacks (start/stop/restart/rebuild)
- Execute commands inside containers with a whitelisted exec shell
- Search container logs with regex in real-time
- Manage Windows Services, processes, and MT5 trading bridges
- Set up scheduled actions (cron-based container automation)
- Configure alert rules with custom thresholds
- Fire webhooks to Slack/Discord/n8n on container events
- View a visual system map of your entire Docker topology
- Switch between servers instantly -- Linux VPS, Windows Server, whatever you run

Built with a security-first mindset: 2 full audits (35 findings fixed), role-based access (admin/operator/viewer), JWT auth with rate limiting, and zero public ports on the API.

**Tech:**
- Backend: Express + Docker Engine API (Linux) / Flask + psutil (Windows)
- Mobile: Expo 55 + React Native
- CLI: Zero-dependency terminal companion with 20 commands
- 10,000+ lines of code across 4 packages

Running in production managing 16 Docker containers + a Windows Server with 210 services.

MIT licensed: https://github.com/Bigabou007-dev/lagoon-cockpit

#OpenSource #DevOps #Docker #ReactNative #MobileFirst #InfrastructureMonitoring #SelfHosted #WindowsServer
