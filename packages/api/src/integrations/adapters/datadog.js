const { BaseAdapter, createMetric, createEvent, createAlert } = require("../adapter");
const { safeFetch } = require("../../security/url-validator");

/**
 * Datadog adapter — pulls metrics, events, and monitor alerts from Datadog API v1.
 */
class DatadogAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.name = "datadog";
    this.displayName = "Datadog";
    this.pollInterval = config.poll_interval || 30;
  }

  async validateConfig() {
    const errors = [];
    if (!this.config.api_key) errors.push("api_key is required");
    if (!this.config.app_key) errors.push("app_key is required");
    return { valid: errors.length === 0, errors };
  }

  async testConnection() {
    const start = Date.now();
    try {
      const res = await safeFetch(`${this._baseUrl()}/validate`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.json();

      return {
        ok: res.ok && body.valid === true,
        message: res.ok ? "Datadog API key is valid" : `HTTP ${res.status}: ${body.errors?.[0] || res.statusText}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return { ok: false, message: err.message, latencyMs: Date.now() - start };
    }
  }

  async pull() {
    const points = [];

    // Pull monitors → alerts
    try {
      const res = await safeFetch(`${this._baseUrl()}/monitor`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const monitors = await res.json();
        for (const mon of monitors) {
          points.push(
            createAlert(
              this.name,
              "",
              mon.name || "Datadog Monitor",
              this._mapPriority(mon.priority),
              this._mapMonitorStatus(mon.overall_state),
              `https://app.${this._site()}/monitors/${mon.id}`,
            ),
          );
        }
      }
    } catch {
      // Skip monitors on failure
    }

    // Pull recent events
    const now = Math.floor(Date.now() / 1000);
    const fiveMinAgo = now - 300;

    try {
      const res = await safeFetch(`${this._baseUrl()}/events?start=${fiveMinAgo}&end=${now}`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const body = await res.json();
        const events = body.events || [];
        for (const evt of events) {
          points.push(
            createEvent(this.name, "", evt.title || "Datadog Event", evt.alert_type || "info", evt.text || ""),
          );
        }
      }
    } catch {
      // Skip events on failure
    }

    // Pull CPU metric
    try {
      const query = "avg:system.cpu.user{*}";
      const res = await safeFetch(
        `${this._baseUrl()}/query?query=${encodeURIComponent(query)}&from=${fiveMinAgo}&to=${now}`,
        { headers: this._headers(), signal: AbortSignal.timeout(15000) },
      );

      if (res.ok) {
        const body = await res.json();
        const series = body.series || [];
        for (const s of series) {
          const lastPoint = s.pointlist?.[s.pointlist.length - 1];
          if (lastPoint) {
            points.push(
              createMetric(this.name, "", s.metric || "system.cpu.user", lastPoint[1], "percent", {
                scope: s.scope || "",
                display_name: s.display_name || "",
              }),
            );
          }
        }
      }
    } catch {
      // Skip metrics on failure
    }

    return points;
  }

  _baseUrl() {
    const site = this._site();
    return `https://api.${site}/api/v1`;
  }

  _site() {
    return this.config.site || "datadoghq.com";
  }

  _headers() {
    return {
      "DD-API-KEY": this.config.api_key,
      "DD-APPLICATION-KEY": this.config.app_key,
      "Content-Type": "application/json",
    };
  }

  /**
   * Map Datadog monitor status to normalized alert status.
   */
  _mapMonitorStatus(status) {
    const map = {
      OK: "ok",
      Alert: "firing",
      Warn: "warning",
      "No Data": "unknown",
    };
    return map[status] || "unknown";
  }

  /**
   * Map Datadog priority (P1-P5) to normalized severity.
   */
  _mapPriority(priority) {
    if (!priority) return "medium";
    const map = {
      1: "critical",
      2: "high",
      3: "medium",
      4: "low",
      5: "info",
    };
    return map[priority] || "medium";
  }

  static configSchema() {
    return {
      type: "object",
      properties: {
        api_key: { type: "string", title: "API Key", description: "Datadog API key" },
        app_key: { type: "string", title: "Application Key", description: "Datadog application key" },
        site: {
          type: "string",
          title: "Datadog Site",
          description: "Datadog site domain (default: datadoghq.com)",
          default: "datadoghq.com",
        },
      },
      required: ["api_key", "app_key"],
    };
  }
}

module.exports = DatadogAdapter;
