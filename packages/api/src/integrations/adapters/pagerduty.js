const { BaseAdapter, createMetric, createEvent, createAlert } = require("../adapter");
const { safeFetch } = require("../../security/url-validator");

/**
 * PagerDuty adapter — pulls incidents, resolved events, and analytics from PagerDuty REST API v2.
 */
class PagerDutyAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.name = "pagerduty";
    this.displayName = "PagerDuty";
    this.pollInterval = config.poll_interval || 30;
  }

  async validateConfig() {
    const errors = [];
    if (!this.config.api_token) errors.push("api_token is required");
    return { valid: errors.length === 0, errors };
  }

  async testConnection() {
    const start = Date.now();
    try {
      const res = await safeFetch(`${this._baseUrl()}/abilities`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(10000),
      });

      return {
        ok: res.ok,
        message: res.ok ? "PagerDuty API token is valid" : `HTTP ${res.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return { ok: false, message: err.message, latencyMs: Date.now() - start };
    }
  }

  async pull() {
    const points = [];

    // Pull active incidents (triggered + acknowledged) → alerts
    try {
      const res = await safeFetch(
        `${this._baseUrl()}/incidents?statuses[]=triggered&statuses[]=acknowledged&limit=25`,
        { headers: this._headers(), signal: AbortSignal.timeout(15000) },
      );

      if (res.ok) {
        const body = await res.json();
        const incidents = body.incidents || [];
        for (const inc of incidents) {
          points.push(
            createAlert(
              this.name,
              "",
              inc.title || inc.summary || "PagerDuty Incident",
              this._mapUrgency(inc.urgency),
              this._mapStatus(inc.status),
              inc.html_url || null,
            ),
          );
        }
      }
    } catch {
      // Skip active incidents on failure
    }

    // Pull recently resolved incidents → events
    const twentyFourHoursAgo = new Date(Date.now() - 86400000).toISOString();

    try {
      const res = await safeFetch(
        `${this._baseUrl()}/incidents?statuses[]=resolved&since=${encodeURIComponent(twentyFourHoursAgo)}&limit=25`,
        { headers: this._headers(), signal: AbortSignal.timeout(15000) },
      );

      if (res.ok) {
        const body = await res.json();
        const incidents = body.incidents || [];
        for (const inc of incidents) {
          points.push(
            createEvent(
              this.name,
              "",
              `Resolved: ${inc.title || inc.summary || "Incident"}`,
              "info",
              JSON.stringify({
                id: inc.id,
                service: inc.service?.summary,
                resolved_at: inc.last_status_change_at,
                urgency: inc.urgency,
              }),
            ),
          );
        }
      }
    } catch {
      // Skip resolved incidents on failure
    }

    // Pull incident analytics → metrics
    try {
      const res = await safeFetch(`${this._baseUrl()}/analytics/metrics/incidents/all`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          filters: {
            created_at_start: twentyFourHoursAgo,
            created_at_end: new Date().toISOString(),
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const body = await res.json();
        const data = body.data || {};

        if (data.mean_seconds_to_resolve !== undefined) {
          points.push(createMetric(this.name, "", "mean_time_to_resolve", data.mean_seconds_to_resolve, "seconds", {}));
        }

        if (data.total_incident_count !== undefined) {
          points.push(createMetric(this.name, "", "total_incidents_24h", data.total_incident_count, "count", {}));
        }

        if (data.mean_seconds_to_first_ack !== undefined) {
          points.push(
            createMetric(this.name, "", "mean_time_to_acknowledge", data.mean_seconds_to_first_ack, "seconds", {}),
          );
        }

        if (data.total_interruptions !== undefined) {
          points.push(createMetric(this.name, "", "total_interruptions_24h", data.total_interruptions, "count", {}));
        }
      }
    } catch {
      // Skip analytics on failure
    }

    return points;
  }

  _baseUrl() {
    return "https://api.pagerduty.com";
  }

  _headers() {
    return {
      Authorization: `Token token=${this.config.api_token}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Map PagerDuty urgency to normalized severity.
   */
  _mapUrgency(urgency) {
    const map = {
      high: "critical",
      low: "low",
    };
    return map[urgency] || "medium";
  }

  /**
   * Map PagerDuty incident status to normalized alert status.
   */
  _mapStatus(status) {
    const map = {
      triggered: "firing",
      acknowledged: "acknowledged",
      resolved: "ok",
    };
    return map[status] || "unknown";
  }

  static configSchema() {
    return {
      type: "object",
      properties: {
        api_token: {
          type: "string",
          title: "API Token",
          description: "PagerDuty REST API v2 token",
        },
      },
      required: ["api_token"],
    };
  }
}

module.exports = PagerDutyAdapter;
