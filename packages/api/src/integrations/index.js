/**
 * Integration system entry point.
 * Initializes the store, registers built-in adapters, and starts the scheduler.
 */

const { initStore } = require("./store");
const { registerAdapter } = require("./registry");
const { initScheduler } = require("./scheduler");

// Built-in adapters
const PrometheusAdapter = require("./adapters/prometheus");
const GrafanaAdapter = require("./adapters/grafana");
const HttpJsonAdapter = require("./adapters/http-json");

/**
 * Initialize the integration system.
 * @param {object} db - SQLite database instance
 * @param {Function} broadcast - SSE broadcast function
 */
function initIntegrations(db, broadcast) {
  // Initialize SQLite tables
  initStore(db);

  // Register built-in adapters
  registerAdapter("prometheus", PrometheusAdapter);
  registerAdapter("grafana", GrafanaAdapter);
  registerAdapter("http-json", HttpJsonAdapter);

  // Start the poll scheduler
  initScheduler(broadcast);

  console.log("[INTEGRATIONS] System initialized with 3 built-in adapters");
}

module.exports = { initIntegrations };
