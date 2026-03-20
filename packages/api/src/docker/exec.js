const { dockerAPI } = require("./client");

// Allowed commands whitelist — prevents arbitrary code execution
const ALLOWED_COMMANDS = [
  // Health checks
  "pg_isready", "redis-cli ping", "redis-cli info", "nginx -t",
  "mysql -e 'SELECT 1'", "mongosh --eval 'db.runCommand({ping:1})'",
  // Diagnostics
  "whoami", "hostname", "date", "uptime", "df -h", "free -m",
  "ps aux", "top -bn1", "cat /etc/os-release", "env",
  "ls", "ls -la", "cat", "head", "tail", "wc -l",
  // Network
  "ip addr", "ip route", "netstat -tlnp", "ss -tlnp",
  "curl -s", "wget -qO-", "nslookup", "dig", "ping -c 1",
];

/**
 * Check if a command is allowed.
 * Allows exact matches or prefix matches from the whitelist.
 */
function isCommandAllowed(cmd) {
  const trimmed = cmd.trim();
  return ALLOWED_COMMANDS.some((allowed) =>
    trimmed === allowed || trimmed.startsWith(allowed + " ")
  );
}

/**
 * Execute a command in a container.
 * @param {string} containerId
 * @param {string} command - The command string to run
 * @returns {Promise<{ output: string, exitCode: number }>}
 */
async function execInContainer(containerId, command) {
  // Create exec instance
  const execCreate = await dockerAPI("POST", `/containers/${containerId}/exec`, {
    AttachStdout: true,
    AttachStderr: true,
    Cmd: ["sh", "-c", command],
  });

  const execId = execCreate.Id;

  // Start exec and get output
  const res = await dockerAPI("POST", `/exec/${execId}/start`, { Detach: false, Tty: false }, { stream: true });

  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", async () => {
      const buf = Buffer.concat(chunks);
      // Parse Docker multiplex stream (8-byte header per frame)
      const lines = [];
      let offset = 0;
      while (offset < buf.length) {
        if (offset + 8 > buf.length) {
          // Remaining data without header — treat as raw output
          lines.push(buf.subarray(offset).toString("utf8"));
          break;
        }
        const size = buf.readUInt32BE(offset + 4);
        if (size === 0) { offset += 8; continue; }
        if (offset + 8 + size > buf.length) {
          lines.push(buf.subarray(offset + 8).toString("utf8"));
          break;
        }
        lines.push(buf.subarray(offset + 8, offset + 8 + size).toString("utf8"));
        offset += 8 + size;
      }

      // Get exit code
      let exitCode = 0;
      try {
        const inspect = await dockerAPI("GET", `/exec/${execId}/json`);
        exitCode = inspect.ExitCode || 0;
      } catch {}

      resolve({ output: lines.join("").trimEnd(), exitCode });
    });
    res.on("error", reject);
  });
}

/**
 * Get running processes in a container (docker top)
 */
async function getContainerTop(containerId) {
  return dockerAPI("GET", `/containers/${containerId}/top`);
}

module.exports = { execInContainer, isCommandAllowed, getContainerTop };
