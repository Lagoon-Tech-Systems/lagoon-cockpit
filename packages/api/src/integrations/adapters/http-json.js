const { BaseAdapter, createMetric, createEvent } = require("../adapter");
const { safeFetch } = require("../../security/url-validator");

/**
 * Generic HTTP/JSON adapter — pulls data from any REST API endpoint.
 * Maps JSON response fields to normalized metrics using user-defined mappings.
 */
class HttpJsonAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.name = "http-json";
    this.displayName = "HTTP / JSON API";
    this.pollInterval = config.poll_interval || 60;
  }

  async validateConfig() {
    const errors = [];
    if (!this.config.url) errors.push("url is required");
    if (this.config.mappings && !Array.isArray(this.config.mappings)) {
      errors.push("mappings must be an array");
    }
    return { valid: errors.length === 0, errors };
  }

  async testConnection() {
    const start = Date.now();
    try {
      const res = await safeFetch(this.config.url, {
        method: this.config.method || "GET",
        headers: this._headers(),
        signal: AbortSignal.timeout(15000),
      });

      return {
        ok: res.ok,
        message: res.ok ? `HTTP ${res.status} OK` : `HTTP ${res.status} ${res.statusText}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return { ok: false, message: err.message, latencyMs: Date.now() - start };
    }
  }

  async pull() {
    const res = await safeFetch(this.config.url, {
      method: this.config.method || "GET",
      headers: this._headers(),
      body: this.config.body ? JSON.stringify(this.config.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const body = await res.json();
    const points = [];
    const mappings = this.config.mappings || [];

    if (mappings.length === 0) {
      // No mappings — store raw response as a single event
      points.push(createEvent(this.name, "", "API Response", "info", JSON.stringify(body).slice(0, 4096)));
      return points;
    }

    // Apply each mapping to extract metrics
    for (const mapping of mappings) {
      try {
        const value = getNestedValue(body, mapping.path);
        if (value === undefined || value === null) continue;

        const numValue = Number(value);
        if (!isNaN(numValue)) {
          points.push(
            createMetric(
              this.name,
              "",
              mapping.name || mapping.path,
              numValue,
              mapping.unit || "",
              mapping.labels || {},
            ),
          );
        } else {
          // Non-numeric value — store as event
          points.push(createEvent(this.name, "", mapping.name || mapping.path, "info", String(value)));
        }
      } catch {
        // Skip failed mappings
      }
    }

    return points;
  }

  _headers() {
    const headers = { Accept: "application/json" };
    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }
    if (this.config.bearerToken) {
      headers["Authorization"] = `Bearer ${this.config.bearerToken}`;
    }
    return headers;
  }

  static configSchema() {
    return {
      type: "object",
      properties: {
        url: { type: "string", title: "API URL", description: "Full URL of the JSON API endpoint" },
        method: { type: "string", title: "HTTP Method", enum: ["GET", "POST"], default: "GET" },
        headers: {
          type: "object",
          title: "Custom Headers",
          additionalProperties: { type: "string" },
        },
        bearerToken: { type: "string", title: "Bearer Token" },
        body: { type: "object", title: "Request Body (POST only)" },
        mappings: {
          type: "array",
          title: "Field Mappings",
          description: "Map JSON response fields to metrics",
          items: {
            type: "object",
            properties: {
              path: { type: "string", title: "JSON Path", description: "Dot-notation path (e.g., data.cpu.usage)" },
              name: { type: "string", title: "Metric Name" },
              unit: { type: "string", title: "Unit" },
              labels: { type: "object", additionalProperties: { type: "string" } },
            },
            required: ["path"],
          },
        },
      },
      required: ["url"],
    };
  }
}

/**
 * Get a nested value from an object using dot-notation path.
 * e.g., getNestedValue({ data: { cpu: 42 } }, "data.cpu") => 42
 */
function getNestedValue(obj, path) {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    // Support array indices: "items.0.value"
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[parseInt(part, 10)];
    } else {
      current = current[part];
    }
  }
  return current;
}

module.exports = HttpJsonAdapter;
