const http = require("http");

const SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
const API_VERSION = "v1.43";

/**
 * Make a request to the Docker Engine API via unix socket.
 * @param {string} method - HTTP method
 * @param {string} path - API path (without version prefix)
 * @param {object|null} body - JSON body for POST/PUT
 * @param {object} opts - Additional options { stream, timeout, query }
 * @returns {Promise<any>}
 */
function dockerAPI(method, path, body = null, opts = {}) {
  const { stream = false, timeout = 30000, query = {} } = opts;

  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const fullPath = `/${API_VERSION}${path}${qs ? `?${qs}` : ""}`;

  return new Promise((resolve, reject) => {
    const reqOpts = {
      socketPath: SOCKET,
      path: fullPath,
      method,
      headers: {},
      timeout,
    };

    if (body) {
      reqOpts.headers["Content-Type"] = "application/json";
    }

    const req = http.request(reqOpts, (res) => {
      if (stream) {
        resolve(res);
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const statusOk = res.statusCode >= 200 && res.statusCode < 300;

        if (!statusOk) {
          let message = raw;
          try {
            message = JSON.parse(raw).message || raw;
          } catch {
            /* ignore */
          }
          reject(Object.assign(new Error(message), { statusCode: res.statusCode }));
          return;
        }

        if (!raw || raw.trim() === "") {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Docker API request timed out"));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = { dockerAPI };
