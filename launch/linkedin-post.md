# LinkedIn Launch Post — Lagoon Cockpit

---

**Post:**

Just open-sourced Lagoon Cockpit — a mobile DevOps dashboard for managing Docker infrastructure from your phone.

The problem: Every time I needed to check on production while away from my desk, it meant SSH-ing from my phone or waiting for a Telegram alert. Portainer and Rancher are great, but they're desktop-first web UIs that don't work well on mobile.

So I built what I wanted: a native mobile app that connects to a lightweight API agent running on each server.

What it does:
- Real-time overview of CPU, RAM, disk, and container health
- Start/stop/restart individual containers or entire Docker Compose stacks
- View container logs from your phone
- SSL certificate and endpoint monitoring
- Push notifications when things go wrong
- Multi-server support — manage multiple VPS from one app
- Role-based access for teams (admin/operator/viewer)

The API is a single Docker container (~22MB RAM) that talks directly to the Docker Engine socket. The mobile app is built with Expo/React Native with biometric lock.

No vendor lock-in. No cloud dependency. Your data stays on your server.

MIT licensed. Contributions welcome.

https://github.com/Bigabou007-dev/lagoon-cockpit

#DevOps #Docker #OpenSource #MobileDevOps #ReactNative #Infrastructure #SelfHosted

---

**Notes for posting:**
- Post from Lagoon Tech Systems company page or personal profile
- Add the repo screenshot or demo GIF as the post image
- Tag relevant communities: #DevOps #Docker #OpenSource
