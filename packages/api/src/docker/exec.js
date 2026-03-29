const { dockerAPI } = require("./client");

// Strict whitelist: EXACT command strings only — no prefix matching, no arguments
const ALLOWED_COMMANDS = [
  // Health checks (exact)
  "pg_isready",
  "redis-cli ping",
  "redis-cli info",
  "nginx -t",
  // Diagnostics (exact, safe)
  "whoami",
  "hostname",
  "date",
  "uptime",
  "df -h",
  "free -m",
  "ps aux",
  "top -bn1",
  "cat /etc/os-release",
  "ls -la /",
  "ip addr",
  "ip route",
  "netstat -tlnp",
  "ss -tlnp",
];

// Block shell metacharacters that enable injection
const SHELL_METACHAR_RE = /[`$|;&><()[\]{}!\\'\n\r]/;

/**
 * Check if a command is allowed.
 * EXACT match only — no prefix matching, no argument appending.
 */
function isCommandAllowed(cmd) {
  const trimmed = cmd.trim();
  // Block shell metacharacters regardless of whitelist
  if (SHELL_METACHAR_RE.test(trimmed)) return false;
  // Exact match only
  return ALLOWED_COMMANDS.includes(trimmed);
}

/**
 * Execute a command in a container.
 * Uses argv array execution — NOT sh -c (prevents shell injection).
 */
async function execInContainer(containerId, command) {
  // Split into argv (simple space split — no shell interpretation)
  const argv = command.trim().split(/\s+/);

  const execCreate = await dockerAPI("POST", `/containers/${containerId}/exec`, {
    AttachStdout: true,
    AttachStderr: true,
    Cmd: argv, // Direct argv, NOT ["sh", "-c", command]
  });

  const execId = execCreate.Id;
  const res = await dockerAPI("POST", `/exec/${execId}/start`, { Detach: false, Tty: false }, { stream: true });

  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", async () => {
      const buf = Buffer.concat(chunks);
      const lines = [];
      let offset = 0;
      while (offset < buf.length) {
        if (offset + 8 > buf.length) {
          lines.push(buf.subarray(offset).toString("utf8"));
          break;
        }
        const size = buf.readUInt32BE(offset + 4);
        if (size === 0) {
          offset += 8;
          continue;
        }
        if (offset + 8 + size > buf.length) {
          lines.push(buf.subarray(offset + 8).toString("utf8"));
          break;
        }
        lines.push(buf.subarray(offset + 8, offset + 8 + size).toString("utf8"));
        offset += 8 + size;
      }

      let exitCode = 0;
      try {
        const inspect = await dockerAPI("GET", `/exec/${execId}/json`);
        exitCode = inspect.ExitCode || 0;
      } catch {
        /* ignore */
      }

      resolve({ output: lines.join("").trimEnd(), exitCode });
    });
    res.on("error", reject);
  });
}

/** Get running processes in a container (docker top) */
async function getContainerTop(containerId) {
  return dockerAPI("GET", `/containers/${containerId}/top`);
}

module.exports = { execInContainer, isCommandAllowed, getContainerTop, ALLOWED_COMMANDS };
