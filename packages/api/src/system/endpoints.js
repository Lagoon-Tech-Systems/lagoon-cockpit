const http = require("http");
const https = require("https");

/**
 * Probe an HTTP endpoint.
 * @param {string} name - Display name
 * @param {string} url - URL to probe
 * @param {number} expectedStatus - Expected HTTP status code
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<object>}
 */
function probeEndpoint(name, url, expectedStatus = 200, timeout = 15000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const client = url.startsWith("https") ? https : http;

    const req = client.get(url, { timeout, rejectUnauthorized: false }, (res) => {
      // Consume response body
      res.resume();
      res.on("end", () => {
        const elapsed = Date.now() - startTime;
        resolve({
          name,
          url,
          status: res.statusCode,
          expected: expectedStatus,
          healthy: res.statusCode === expectedStatus,
          responseTime: elapsed,
        });
      });
    });

    req.on("error", (err) => {
      resolve({
        name,
        url,
        status: null,
        expected: expectedStatus,
        healthy: false,
        responseTime: Date.now() - startTime,
        error: err.message,
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        name,
        url,
        status: null,
        expected: expectedStatus,
        healthy: false,
        responseTime: timeout,
        error: "Request timed out",
      });
    });
  });
}

/**
 * Parse ENDPOINTS env var and probe all.
 * Format: "Name|URL|ExpectedStatus,Name2|URL2|200"
 */
async function probeAllEndpoints(endpointsStr) {
  if (!endpointsStr) return [];

  const entries = endpointsStr.split(",").filter(Boolean);
  const probes = entries.map((entry) => {
    const [name, url, status] = entry.split("|");
    return probeEndpoint(name?.trim(), url?.trim(), parseInt(status?.trim() || "200", 10));
  });

  return Promise.all(probes);
}

module.exports = { probeEndpoint, probeAllEndpoints };
