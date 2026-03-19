# Privacy Notice — Lagoon Cockpit

**Effective date:** March 19, 2026
**Maintainer:** Lagoon Tech Systems

Lagoon Cockpit is a self-hosted, open-source Docker management tool. This notice explains what data the software handles and where it resides.

---

## 1. Data Collected by the API Server

The API server runs on **your own infrastructure**. It collects and stores:

| Data category | Purpose | Storage location |
|---|---|---|
| System metrics (CPU, memory, disk) | Dashboard display | SQLite database on your server |
| Docker container information (names, status, logs) | Container management | SQLite database on your server |
| User accounts (username, hashed password) | Authentication (multi-user mode) | SQLite database on your server |
| Audit logs (actions performed, timestamps) | Accountability and troubleshooting | SQLite database on your server |
| Expo push tokens | Sending push notifications to your device | SQLite database on your server |

All data is stored in a single SQLite file on your server. Lagoon Tech Systems has no access to it.

## 2. Data Stored by the Mobile App

The Expo / React Native mobile app stores the following locally on your device:

- **Server profiles** (host, port, display name) — stored in app storage
- **JWT authentication tokens** — stored in the device's secure enclave via `expo-secure-store`
- **Expo push token** — stored in app memory for registration with your server

No data is synced to any cloud service operated by Lagoon Tech Systems.

## 3. Data Retention

Because Lagoon Cockpit is entirely self-hosted, **you control your own data**. The SQLite database persists on your server until you delete it. There are no remote backups, no cloud sync, and no external data stores managed by the project maintainers.

To delete all data, stop the container and remove the SQLite database file.

## 4. Push Notifications

When push notifications are enabled, the app registers an **Expo push token** with your Lagoon Cockpit API server. When the server sends a notification, it transmits that token and the notification payload to **Expo's push notification service** (`https://exp.host/--/api/v2/push/send`), which relays it to Apple (APNs) or Google (FCM).

This is the **only instance** where data leaves your server. The payload typically contains alert titles and container status summaries. Expo's privacy policy applies to data transiting their service: https://expo.dev/privacy

Push notifications are optional and can be disabled.

## 5. Telemetry, Analytics, and Tracking

Lagoon Cockpit includes:

- **No telemetry**
- **No analytics**
- **No crash reporting**
- **No advertising SDKs**
- **No data transmission to Lagoon Tech Systems or any third party** (except Expo push notifications as described above)

## 6. GDPR and Data Sovereignty

All operational data resides exclusively on infrastructure you own or control. Because no personal data is transmitted to Lagoon Tech Systems:

- There is no data controller relationship between you and Lagoon Tech Systems with respect to this software.
- You are the sole data controller for any personal data stored in your Lagoon Cockpit instance.
- Data subject access, rectification, and deletion requests are fulfilled by managing your own SQLite database.

This architecture is compatible with GDPR, CCPA, and other data-sovereignty regulations by design.

## 7. Changes to This Notice

Updates to this notice will be committed to the project repository. The effective date at the top of this document reflects the most recent revision.

## 8. Contact

For questions about this privacy notice, open an issue on the project repository or contact **legal@lagoontechsystems.com**.
