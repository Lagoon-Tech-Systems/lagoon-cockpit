const fs = require("fs");
const { execSync } = require("child_process");

const PROC = process.env.PROC_PATH || "/proc";

/** Read CPU usage from /proc/stat — returns a snapshot; call twice and diff for % */
function readCpuTimes() {
  try {
    const stat = fs.readFileSync(`${PROC}/stat`, "utf8");
    const line = stat.split("\n").find((l) => l.startsWith("cpu "));
    if (!line) return null;
    const parts = line.split(/\s+/).slice(1).map(Number);
    const [user, nice, system, idle, iowait, irq, softirq, steal] = parts;
    const total = user + nice + system + idle + iowait + irq + softirq + steal;
    const busy = total - idle - iowait;
    return { total, busy, idle: idle + iowait };
  } catch {
    return null;
  }
}

/** Calculate CPU % between two snapshots */
function calcCpuPercent(prev, curr) {
  if (!prev || !curr) return 0;
  const totalDiff = curr.total - prev.total;
  const busyDiff = curr.busy - prev.busy;
  if (totalDiff <= 0) return 0;
  return Math.round((busyDiff / totalDiff) * 10000) / 100;
}

/** Read memory info from /proc/meminfo */
function readMemory() {
  try {
    const raw = fs.readFileSync(`${PROC}/meminfo`, "utf8");
    const get = (key) => {
      const m = raw.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? parseInt(m[1], 10) * 1024 : 0; // kB → bytes
    };

    const total = get("MemTotal");
    const free = get("MemFree");
    const buffers = get("Buffers");
    const cached = get("Cached");
    const available = get("MemAvailable") || free + buffers + cached;
    const used = total - available;

    return {
      total,
      used,
      free: available,
      percent: total > 0 ? Math.round((used / total) * 10000) / 100 : 0,
    };
  } catch {
    return { total: 0, used: 0, free: 0, percent: 0 };
  }
}

/** Read disk usage via df */
function readDisk() {
  try {
    const raw = execSync("df -B1 / 2>/dev/null", {
      encoding: "utf8",
      timeout: 5000,
    });
    const lines = raw.trim().split("\n");
    if (lines.length < 2) return { total: 0, used: 0, free: 0, percent: 0 };

    const parts = lines[1].split(/\s+/);
    const total = parseInt(parts[1], 10);
    const used = parseInt(parts[2], 10);
    const free = parseInt(parts[3], 10);
    const percent = total > 0 ? Math.round((used / total) * 10000) / 100 : 0;

    return { total, used, free, percent, mountpoint: parts[5] };
  } catch {
    return { total: 0, used: 0, free: 0, percent: 0 };
  }
}

/** Read load average from /proc/loadavg */
function readLoadAvg() {
  try {
    const raw = fs.readFileSync(`${PROC}/loadavg`, "utf8");
    const parts = raw.trim().split(/\s+/);
    return {
      load1: parseFloat(parts[0]),
      load5: parseFloat(parts[1]),
      load15: parseFloat(parts[2]),
    };
  } catch {
    return { load1: 0, load5: 0, load15: 0 };
  }
}

/** Read uptime from /proc/uptime */
function readUptime() {
  try {
    const raw = fs.readFileSync(`${PROC}/uptime`, "utf8");
    const seconds = parseFloat(raw.split(/\s+/)[0]);
    return Math.floor(seconds);
  } catch {
    return 0;
  }
}

/** Read CPU count */
function readCpuCount() {
  try {
    const raw = fs.readFileSync(`${PROC}/cpuinfo`, "utf8");
    return (raw.match(/^processor\s/gm) || []).length || 1;
  } catch {
    return 1;
  }
}

/** Read hostname */
function readHostname() {
  try {
    return fs.readFileSync(`${PROC}/sys/kernel/hostname`, "utf8").trim();
  } catch {
    return "unknown";
  }
}

// Keep a rolling CPU snapshot for % calculation
let _prevCpu = readCpuTimes();

/** Get all system metrics as a single object */
function getSystemMetrics() {
  const currCpu = readCpuTimes();
  const cpuPercent = calcCpuPercent(_prevCpu, currCpu);
  _prevCpu = currCpu;

  return {
    hostname: readHostname(),
    cpuPercent,
    cpuCount: readCpuCount(),
    memory: readMemory(),
    disk: readDisk(),
    load: readLoadAvg(),
    uptimeSeconds: readUptime(),
  };
}

module.exports = { getSystemMetrics, readCpuTimes, calcCpuPercent };
