/**
 * Base adapter interface for data source integrations.
 * Every adapter (Prometheus, Grafana, Datadog, etc.) extends this class.
 *
 * Adapters must implement:
 *   - validateConfig() — verify user-provided config is valid
 *   - testConnection() — test connectivity to the external service
 *   - pull() — fetch and return normalized data
 *   - static configSchema() — return JSON schema for the UI config form
 */

class BaseAdapter {
  constructor(config) {
    this.name = ""; // Machine name, e.g., "prometheus"
    this.displayName = ""; // Human name, e.g., "Prometheus"
    this.version = "1.0.0";
    this.pollInterval = 30; // seconds
    this.config = config; // User-provided config (URL, API key, etc.)
  }

  /**
   * Validate user-provided configuration.
   * @returns {{ valid: boolean, errors?: string[] }}
   */
  async validateConfig() {
    throw new Error("validateConfig() not implemented");
  }

  /**
   * Test connectivity to the external service.
   * @returns {{ ok: boolean, message: string, latencyMs?: number }}
   */
  async testConnection() {
    throw new Error("testConnection() not implemented");
  }

  /**
   * Pull data from the external service.
   * Must return an array of normalized data points.
   * @returns {NormalizedDataPoint[]}
   */
  async pull() {
    throw new Error("pull() not implemented");
  }

  /**
   * Return the JSON schema describing config fields.
   * The app renders a form from this schema.
   * @returns {object} JSON Schema
   */
  static configSchema() {
    return {
      type: "object",
      properties: {},
      required: [],
    };
  }
}

/**
 * Normalized data point schema.
 * All adapter outputs must conform to this structure.
 *
 * @typedef {object} NormalizedDataPoint
 * @property {string} source - Adapter name (e.g., "prometheus")
 * @property {string} sourceId - Integration instance ID
 * @property {string} timestamp - ISO 8601 timestamp
 * @property {"metric"|"event"|"alert"|"incident"} type - Data type
 * @property {object} [metric] - { name, value, unit, labels }
 * @property {object} [event] - { title, severity, body }
 * @property {object} [alert] - { title, severity, status, source_url }
 */

/**
 * Helper to create a normalized metric point.
 */
function createMetric(source, sourceId, name, value, unit, labels = {}) {
  return {
    source,
    sourceId,
    timestamp: new Date().toISOString(),
    type: "metric",
    metric: { name, value, unit, labels },
  };
}

/**
 * Helper to create a normalized event point.
 */
function createEvent(source, sourceId, title, severity, body) {
  return {
    source,
    sourceId,
    timestamp: new Date().toISOString(),
    type: "event",
    event: { title, severity, body },
  };
}

/**
 * Helper to create a normalized alert point.
 */
function createAlert(source, sourceId, title, severity, status, sourceUrl) {
  return {
    source,
    sourceId,
    timestamp: new Date().toISOString(),
    type: "alert",
    alert: { title, severity, status, source_url: sourceUrl },
  };
}

module.exports = { BaseAdapter, createMetric, createEvent, createAlert };
