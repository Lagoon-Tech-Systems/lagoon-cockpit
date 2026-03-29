const { BaseAdapter, createMetric, createAlert } = require("../adapter");
const { safeFetch } = require("../../security/url-validator");

/**
 * Prometheus adapter — pulls metrics from any Prometheus-compatible endpoint.
 * Supports instant queries and active alerts.
 */
class PrometheusAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.name = "prometheus";
    this.displayName = "Prometheus";
    this.pollInterval = config.poll_interval || 30;
  }

  async validateConfig() {
    const errors = [];
    if (!this.config.url) errors.push("url is required");
    if (this.config.queries && !Array.isArray(this.config.queries)) {
      errors.push("queries must be an array");
    }
    return { valid: errors.length === 0, errors };
  }

  async testConnection() {
    const start = Date.now();
    try {
      const url = `${this.config.url.replace(/\/$/, "")}/-/healthy`;
      const res = await safeFetch(url, {
        headers: this._headers(),
        signal: AbortSignal.timeout(10000),
      });

      return {
        ok: res.ok,
        message: res.ok ? "Prometheus is healthy" : `HTTP ${res.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return { ok: false, message: err.message, latencyMs: Date.now() - start };
    }
  }

  async pull() {
    const baseUrl = this.config.url.replace(/\/$/, "");
    const points = [];

    // Pull configured queries
    const queries = this.config.queries || [{ query: "up", name: "target_up", unit: "boolean" }];

    for (const q of queries) {
      try {
        const res = await safeFetch(`${baseUrl}/api/v1/query?query=${encodeURIComponent(q.query)}`, {
          headers: this._headers(),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) continue;

        const body = await res.json();
        if (body.status !== "success" || !body.data?.result) continue;

        for (const result of body.data.result) {
          const [, value] = result.value || [];
          const labels = result.metric || {};
          points.push(createMetric(this.name, "", q.name || q.query, parseFloat(value), q.unit || "", labels));
        }
      } catch {
        // Skip failed queries
      }
    }

    // Pull active alerts
    if (this.config.pullAlerts !== false) {
      try {
        const res = await safeFetch(`${baseUrl}/api/v1/alerts`, {
          headers: this._headers(),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const body = await res.json();
          const alerts = body.data?.alerts || [];
          for (const alert of alerts) {
            points.push(
              createAlert(
                this.name,
                "",
                alert.labels?.alertname || "Unknown Alert",
                alert.labels?.severity || "warning",
                alert.state || "firing",
                alert.generatorURL || null,
              ),
            );
          }
        }
      } catch {
        // Skip alerts on failure
      }
    }

    return points;
  }

  _headers() {
    const headers = {};
    if (this.config.bearerToken) {
      headers["Authorization"] = `Bearer ${this.config.bearerToken}`;
    }
    if (this.config.basicAuth) {
      const { username, password } = this.config.basicAuth;
      headers["Authorization"] = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    }
    return headers;
  }

  static configSchema() {
    return {
      type: "object",
      properties: {
        url: { type: "string", title: "Prometheus URL", description: "Base URL of the Prometheus server" },
        bearerToken: { type: "string", title: "Bearer Token", description: "Optional authentication token" },
        basicAuth: {
          type: "object",
          title: "Basic Auth",
          properties: {
            username: { type: "string" },
            password: { type: "string" },
          },
        },
        queries: {
          type: "array",
          title: "PromQL Queries",
          description: "Custom queries to run on each poll",
          items: {
            type: "object",
            properties: {
              query: { type: "string", title: "PromQL Query" },
              name: { type: "string", title: "Metric Name" },
              unit: { type: "string", title: "Unit" },
            },
            required: ["query"],
          },
        },
        pullAlerts: { type: "boolean", title: "Pull Active Alerts", default: true },
      },
      required: ["url"],
    };
  }
}

module.exports = PrometheusAdapter;
