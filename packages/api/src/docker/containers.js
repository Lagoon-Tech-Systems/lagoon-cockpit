const { dockerAPI } = require("./client");

/** List all containers with summary info */
async function listContainers(all = true, includeSize = false) {
  const raw = await dockerAPI("GET", "/containers/json", null, {
    query: { all: all ? "true" : "false", size: includeSize ? "true" : "false" },
  });

  return raw.map((c) => ({
    id: c.Id,
    name: (c.Names[0] || "").replace(/^\//, ""),
    image: c.Image,
    imageId: c.ImageID,
    state: c.State,
    status: c.Status,
    created: c.Created,
    ports: (c.Ports || []).map((p) => ({
      private: p.PrivatePort,
      public: p.PublicPort,
      type: p.Type,
      ip: p.IP,
    })),
    health: c.Status?.includes("healthy") ? "healthy" : c.Status?.includes("unhealthy") ? "unhealthy" : null,
    labels: c.Labels || {},
    composeProject: c.Labels?.["com.docker.compose.project"] || null,
    composeService: c.Labels?.["com.docker.compose.service"] || null,
    sizeRw: c.SizeRw,
    sizeRootFs: c.SizeRootFs,
    networkMode: Object.keys(c.NetworkSettings?.Networks || {}),
  }));
}

/** Get detailed container info */
async function inspectContainer(id) {
  return dockerAPI("GET", `/containers/${id}/json`);
}

/** Get one-shot stats for a container */
async function getContainerStats(id) {
  const raw = await dockerAPI("GET", `/containers/${id}/stats`, null, {
    query: { stream: "false" },
    timeout: 10000,
  });

  // Calculate CPU %
  const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage;
  const systemDelta = raw.cpu_stats.system_cpu_usage - raw.precpu_stats.system_cpu_usage;
  const cpuCount = raw.cpu_stats.online_cpus || 1;
  const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

  // Memory
  const memUsage = raw.memory_stats.usage || 0;
  const memLimit = raw.memory_stats.limit || 0;
  const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;

  // Network
  let netRx = 0,
    netTx = 0;
  if (raw.networks) {
    for (const net of Object.values(raw.networks)) {
      netRx += net.rx_bytes || 0;
      netTx += net.tx_bytes || 0;
    }
  }

  return {
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    memoryUsage: memUsage,
    memoryLimit: memLimit,
    memoryPercent: Math.round(memPercent * 100) / 100,
    networkRx: netRx,
    networkTx: netTx,
    pids: raw.pids_stats?.current || 0,
    read: raw.read,
  };
}

/** Get container logs */
async function getContainerLogs(id, { tail = 100, since, stdout = true, stderr = true } = {}) {
  const res = await dockerAPI("GET", `/containers/${id}/logs`, null, {
    stream: true,
    query: {
      stdout: stdout ? "true" : "false",
      stderr: stderr ? "true" : "false",
      tail: String(tail),
      since: since || undefined,
      timestamps: "true",
    },
  });

  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => {
      const buf = Buffer.concat(chunks);
      // Docker log output has 8-byte header per frame: [stream_type, 0, 0, 0, size(4 bytes)]
      const lines = [];
      let offset = 0;
      while (offset < buf.length) {
        if (offset + 8 > buf.length) break;
        const size = buf.readUInt32BE(offset + 4);
        if (offset + 8 + size > buf.length) break;
        const line = buf
          .subarray(offset + 8, offset + 8 + size)
          .toString("utf8")
          .trimEnd();
        if (line) lines.push(line);
        offset += 8 + size;
      }
      resolve(lines);
    });
    res.on("error", reject);
  });
}

/** Start a container */
async function startContainer(id) {
  await dockerAPI("POST", `/containers/${id}/start`);
}

/** Stop a container */
async function stopContainer(id, timeout = 10) {
  await dockerAPI("POST", `/containers/${id}/stop`, null, {
    query: { t: String(timeout) },
    timeout: (timeout + 5) * 1000,
  });
}

/** Restart a container */
async function restartContainer(id, timeout = 10) {
  await dockerAPI("POST", `/containers/${id}/restart`, null, {
    query: { t: String(timeout) },
    timeout: (timeout + 5) * 1000,
  });
}

module.exports = {
  listContainers,
  inspectContainer,
  getContainerStats,
  getContainerLogs,
  startContainer,
  stopContainer,
  restartContainer,
};
