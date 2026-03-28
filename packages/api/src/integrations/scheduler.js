/**
 * Integration poll scheduler.
 * Runs each active integration's adapter at its configured interval.
 * Stores pulled data and updates integration status.
 */

const { createAdapterInstance } = require("./registry");
const { listIntegrations, updateIntegrationStatus, storeDataPoints, cleanupOldData } = require("./store");

let timers = new Map(); // integrationId -> timer handle
let broadcastFn = null;

/**
 * Initialize the scheduler.
 * @param {Function} broadcast - SSE broadcast function
 */
function initScheduler(broadcast) {
  broadcastFn = broadcast;

  // Start polling for all enabled integrations
  refreshSchedules();

  // Cleanup old data every hour
  setInterval(() => cleanupOldData(), 60 * 60 * 1000);

  // Re-check integration configs every 60 seconds (picks up new/changed/deleted integrations)
  setInterval(refreshSchedules, 60 * 1000);
}

/** Refresh all scheduled polls based on current integration configs */
function refreshSchedules() {
  const integrations = listIntegrations();
  const activeIds = new Set();

  for (const integration of integrations) {
    activeIds.add(integration.id);

    if (!integration.enabled) {
      // Stop if running
      if (timers.has(integration.id)) {
        clearInterval(timers.get(integration.id));
        timers.delete(integration.id);
      }
      continue;
    }

    // Already scheduled — skip (unless interval changed, we'll handle that on next full refresh)
    if (timers.has(integration.id)) continue;

    // Schedule new poll
    const intervalMs = (integration.poll_interval || 30) * 1000;
    const timer = setInterval(() => pollIntegration(integration.id), intervalMs);
    timers.set(integration.id, timer);

    // Run first poll immediately
    pollIntegration(integration.id);
  }

  // Stop timers for deleted integrations
  for (const [id, timer] of timers) {
    if (!activeIds.has(id)) {
      clearInterval(timer);
      timers.delete(id);
    }
  }
}

/** Poll a single integration */
async function pollIntegration(integrationId) {
  let integration;
  try {
    // Re-read from DB to get latest config
    const { getIntegration } = require("./store");
    integration = getIntegration(integrationId);
    if (!integration || !integration.enabled) return;

    const adapter = createAdapterInstance(integration.adapter, integration.config);
    if (!adapter) {
      updateIntegrationStatus(integrationId, "error", `Unknown adapter: ${integration.adapter}`);
      return;
    }

    const dataPoints = await adapter.pull();

    if (Array.isArray(dataPoints) && dataPoints.length > 0) {
      // Tag each point with source info
      const taggedPoints = dataPoints.map((p) => ({
        ...p,
        source: integration.adapter,
        sourceId: integrationId,
      }));

      storeDataPoints(integrationId, taggedPoints);
      updateIntegrationStatus(integrationId, "ok", null);

      // Broadcast to SSE clients
      if (broadcastFn) {
        broadcastFn("integration_data", {
          integrationId,
          adapter: integration.adapter,
          name: integration.name,
          points: taggedPoints.slice(0, 50), // Cap broadcast to 50 points
        });
      }
    } else {
      updateIntegrationStatus(integrationId, "ok", null);
    }
  } catch (err) {
    const name = integration?.name || integrationId;
    console.error(`[INTEGRATIONS] Poll failed for ${name}: ${err.message}`);
    updateIntegrationStatus(integrationId, "error", err.message);
  }
}

/** Stop all polling (for graceful shutdown) */
function stopAll() {
  for (const [id, timer] of timers) {
    clearInterval(timer);
  }
  timers.clear();
}

/** Force re-poll a specific integration */
async function forcePoll(integrationId) {
  return pollIntegration(integrationId);
}

module.exports = { initScheduler, refreshSchedules, stopAll, forcePoll };
