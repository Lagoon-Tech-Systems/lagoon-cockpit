# LinkedIn Post — Lagoon Cockpit Launch

---

Just open-sourced **Lagoon Cockpit** -- a mobile-first DevOps dashboard for Docker infrastructure.

The problem: you're away from your desk, something goes down, and your only option is SSH from a phone keyboard. Or you get a Telegram alert but can't actually do anything about it.

Lagoon Cockpit gives you a native mobile app that connects to a lightweight API agent running on each server. From your phone you can:

- See CPU, RAM, disk, and load at a glance
- View all containers and Docker Compose stacks with live status
- Start, stop, restart containers and entire stacks
- Monitor SSL certificate expiry and HTTP endpoint health
- Get push notifications when something goes wrong
- Manage multiple servers from one app

It's like having a pocket-sized Portainer, purpose-built for mobile.

**Tech stack:**
- Backend: Express + Docker Engine API (via unix socket, zero shell commands)
- Mobile: Expo + React Native
- Auth: Dual mode -- single API key for solo ops, or multi-user with admin/operator/viewer roles
- Security: Full audit with 17 findings fixed before launch

Currently running in production monitoring 16 containers across 5 compose stacks.

MIT licensed. Check it out: https://github.com/Bigabou007-dev/lagoon-cockpit

#OpenSource #DevOps #Docker #ReactNative #MobileFirst #InfrastructureMonitoring #SelfHosted
