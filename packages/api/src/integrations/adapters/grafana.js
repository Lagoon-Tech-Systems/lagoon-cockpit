const { BaseAdapter, createAlert, createEvent } = require("../adapter");
const { safeFetch } = require("../../security/url-validator");

/**
 * Grafana adapter — pulls alerts, annotations, and dashboard health.
 */
class GrafanaAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.name = "grafana";
    this.displayName = "Grafana";
    this.pollInterval = config.poll_interval || 60;
  }

  async validateConfig() {
    const errors = [];
    if (!this.config.url) errors.push("url is required");
    if (!this.config.apiKey && !this.config.serviceAccountToken) {
      errors.push("apiKey or serviceAccountToken is required");
    }
    return { valid: errors.length === 0, errors };
  }

  async testConnection() {
    const start = Date.now();
    try {
      const res = await safeFetch(`${this._baseUrl()}/api/health`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.json();

      return {
        ok: body.database === "ok",
        message: body.database === "ok" ? "Grafana is healthy" : `Database: ${body.database}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return { ok: false, message: err.message, latencyMs: Date.now() - start };
    }
  }

  async pull() {
    const points = [];

    // Pull active alerts
    try {
      const res = await safeFetch(`${this._baseUrl()}/api/v1/provisioning/alert-rules`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const rules = await res.json();
        for (const rule of rules) {
          if (rule.data && rule.data.length > 0) {
            points.push(
              createAlert(
                this.name,
                "",
                rule.title || "Grafana Alert",
                rule.labels?.severity || "warning",
                rule.isPaused ? "paused" : "active",
                `${this._baseUrl()}/alerting/${rule.uid}/edit`,
              ),
            );
          }
        }
      }
    } catch {
      // Skip on failure
    }

    // Pull recent annotations (last poll interval)
    if (this.config.pullAnnotations !== false) {
      try {
        const from = Date.now() - this.pollInterval * 1000 * 2; // 2x interval for overlap
        const res = await safeFetch(`${this._baseUrl()}/api/annotations?from=${from}&to=${Date.now()}`, {
          headers: this._headers(),
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const annotations = await res.json();
          for (const ann of annotations) {
            points.push(
              createEvent(
                this.name,
                "",
                ann.text || "Annotation",
                ann.tags?.includes("critical") ? "critical" : "info",
                JSON.stringify({ dashboardId: ann.dashboardId, panelId: ann.panelId, tags: ann.tags }),
              ),
            );
          }
        }
      } catch {
        // Skip on failure
      }
    }

    return points;
  }

  _baseUrl() {
    return this.config.url.replace(/\/$/, "");
  }

  _headers() {
    const headers = { "Content-Type": "application/json" };
    const token = this.config.serviceAccountToken || this.config.apiKey;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  static configSchema() {
    return {
      type: "object",
      properties: {
        url: { type: "string", title: "Grafana URL", description: "Base URL of the Grafana instance" },
        apiKey: { type: "string", title: "API Key (legacy)" },
        serviceAccountToken: {
          type: "string",
          title: "Service Account Token",
          description: "Recommended over API key",
        },
        pullAnnotations: { type: "boolean", title: "Pull Annotations", default: true },
      },
      required: ["url"],
    };
  }
}

module.exports = GrafanaAdapter;
