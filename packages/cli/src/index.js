#!/usr/bin/env node

const { loadConfig, saveConfig, getActiveServer, request, authenticate } = require("./api");

const COLORS = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m", white: "\x1b[37m", gray: "\x1b[90m",
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function statusDot(state) {
  if (state === "running") return c("green", "●");
  if (state === "exited" || state === "dead") return c("red", "●");
  if (state === "restarting") return c("yellow", "●");
  return c("gray", "●");
}

function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] || "").length)));
  const sep = widths.map((w) => "─".repeat(w + 2)).join("┼");
  console.log(c("dim", "┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐"));
  console.log("│ " + headers.map((h, i) => c("bold", h.padEnd(widths[i]))).join(" │ ") + " │");
  console.log(c("dim", "├" + sep + "┤"));
  for (const row of rows) {
    console.log("│ " + row.map((cell, i) => String(cell || "").padEnd(widths[i])).join(" │ ") + " │");
  }
  console.log(c("dim", "└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘"));
}

// ── Commands ───────────────────────────────────────────────

const commands = {
  async connect(args) {
    const [url, apiKey, name] = args;
    if (!url || !apiKey) {
      console.log(`Usage: cockpit connect <url> <api-key> [name]`);
      console.log(`Example: cockpit connect http://100.69.138.90:3000 my-api-key "Production VPS"`);
      return;
    }

    try {
      const data = await authenticate(url.replace(/\/+$/, ""), apiKey);
      const serverName = name || data.serverName || "Server";
      const config = loadConfig();
      const existing = config.servers.findIndex((s) => s.url === url);
      const entry = { name: serverName, url: url.replace(/\/+$/, ""), token: data.accessToken, refreshToken: data.refreshToken, role: data.role };
      if (existing >= 0) config.servers[existing] = entry;
      else config.servers.push(entry);
      config.active = serverName;
      saveConfig(config);
      console.log(c("green", `✓ Connected to ${serverName} (${data.role})`));
    } catch (err) {
      console.error(c("red", `✗ ${err.message}`));
    }
  },

  async servers() {
    const config = loadConfig();
    if (!config.servers.length) { console.log(c("dim", "No servers configured. Run: cockpit connect <url> <key>")); return; }
    for (const s of config.servers) {
      const active = s.name === config.active ? c("green", " ← active") : "";
      console.log(`  ${c("bold", s.name)} ${c("dim", s.url)}${active}`);
    }
  },

  async use(args) {
    const [name] = args;
    if (!name) { console.log("Usage: cockpit use <server-name>"); return; }
    const config = loadConfig();
    const server = config.servers.find((s) => s.name === name);
    if (!server) { console.error(c("red", `Server "${name}" not found`)); return; }
    config.active = name;
    saveConfig(config);
    console.log(c("green", `✓ Switched to ${name}`));
  },

  async overview() {
    const data = await request("GET", "/api/overview");
    const s = data.system;
    console.log(`\n${c("bold", data.serverName)} ${c("dim", "— up " + formatUptime(s.uptimeSeconds))}\n`);
    console.log(`  CPU   ${progressBar(s.cpuPercent)} ${s.cpuPercent.toFixed(1)}% (${s.cpuCount} cores)`);
    console.log(`  RAM   ${progressBar(s.memory.percent)} ${s.memory.percent.toFixed(1)}% (${formatBytes(s.memory.used)} / ${formatBytes(s.memory.total)})`);
    console.log(`  Disk  ${progressBar(s.disk.percent)} ${s.disk.percent.toFixed(1)}% (${formatBytes(s.disk.used)} / ${formatBytes(s.disk.total)})`);
    console.log(`  Load  ${s.load.load1.toFixed(2)} / ${s.load.load5.toFixed(2)} / ${s.load.load15.toFixed(2)}`);
    console.log(`\n  Containers: ${c("green", data.containers.running)} running, ${data.containers.stopped > 0 ? c("red", data.containers.stopped) : "0"} stopped, ${data.containers.unhealthy > 0 ? c("yellow", data.containers.unhealthy) : "0"} unhealthy`);
    console.log(`  Stacks: ${data.stacks.total} total, ${data.stacks.allHealthy ? c("green", "all healthy") : c("red", "issues detected")}\n`);
  },

  async ps(args) {
    const data = await request("GET", "/api/containers");
    const filter = args[0];
    let list = data.containers;
    if (filter === "running") list = list.filter((c) => c.state === "running");
    if (filter === "stopped") list = list.filter((c) => c.state !== "running");

    table(
      ["", "NAME", "STATE", "IMAGE", "STACK"],
      list.map((c) => [statusDot(c.state), c.name, c.state, c.image.split(":")[0].split("/").pop(), c.composeProject || "-"])
    );
    console.log(c("dim", `  ${list.length} containers\n`));
  },

  async stacks() {
    const data = await request("GET", "/api/stacks");
    table(
      ["", "STACK", "STATUS", "CONTAINERS", "RUNNING"],
      data.stacks.map((s) => [s.stopped > 0 ? c("red", "●") : c("green", "●"), s.name, s.status, s.containerCount, `${s.running}/${s.containerCount}`])
    );
  },

  async logs(args) {
    const [id, ...rest] = args;
    if (!id) { console.log("Usage: cockpit logs <container-id-or-name> [--tail N] [--search query]"); return; }
    const tail = rest.includes("--tail") ? rest[rest.indexOf("--tail") + 1] : "50";
    const searchIdx = rest.indexOf("--search");

    if (searchIdx >= 0) {
      const query = rest[searchIdx + 1];
      const data = await request("GET", `/api/containers/${id}/logs/search?q=${encodeURIComponent(query)}&regex=true`);
      console.log(c("dim", `${data.matches.length} matches in ${data.totalLines} lines:\n`));
      for (const m of data.matches) {
        console.log(c("yellow", `  Line ${m.lineNumber}:`) + ` ${m.line}`);
      }
    } else {
      const data = await request("GET", `/api/containers/${id}/logs?tail=${tail}`);
      for (const line of data.lines) console.log(`  ${line}`);
    }
  },

  async exec(args) {
    const [id, ...cmdParts] = args;
    if (!id || !cmdParts.length) { console.log("Usage: cockpit exec <container> <command>"); return; }
    const command = cmdParts.join(" ");
    try {
      const result = await request("POST", `/api/containers/${id}/exec`, { command });
      console.log(result.output);
      if (result.exitCode !== 0) console.log(c("yellow", `\nexit code: ${result.exitCode}`));
    } catch (err) {
      console.error(c("red", err.message));
    }
  },

  async start(args) { await containerAction(args[0], "start"); },
  async stop(args) { await containerAction(args[0], "stop"); },
  async restart(args) { await containerAction(args[0], "restart"); },

  async images() {
    const data = await request("GET", "/api/images");
    table(
      ["IMAGE", "SIZE", "CONTAINERS"],
      data.images.map((img) => [img.repoTags[0] || img.id.slice(7, 19), formatBytes(img.size), img.containers])
    );
    const total = data.images.reduce((s, img) => s + img.size, 0);
    console.log(c("dim", `  ${data.images.length} images, ${formatBytes(total)} total\n`));
  },

  async networks() {
    const data = await request("GET", "/api/networks");
    for (const net of data.networks) {
      console.log(`  ${c("bold", net.name)} ${c("dim", `(${net.driver})`)} — ${net.containers.length} containers`);
      for (const ct of net.containers) {
        console.log(`    ${c("dim", "└")} ${ct.name} ${c("dim", ct.ipv4)}`);
      }
    }
  },

  async disk() {
    const data = await request("GET", "/api/system/disk");
    console.log(`\n  ${c("bold", "Disk Usage Breakdown")}\n`);
    console.log(`  Containers   ${formatBytes(data.containers.size).padStart(10)}  (${data.containers.count} items)`);
    console.log(`  Images       ${formatBytes(data.images.size).padStart(10)}  (${data.images.count} items)`);
    console.log(`  Volumes      ${formatBytes(data.volumes.size).padStart(10)}  (${data.volumes.count} items)`);
    console.log(`  Build Cache  ${formatBytes(data.buildCache.size).padStart(10)}  (${data.buildCache.count} items)`);
    console.log(`  ${"─".repeat(35)}`);
    console.log(`  ${c("bold", "Total")}          ${formatBytes(data.totalSize).padStart(10)}\n`);
  },

  async prune() {
    console.log(c("yellow", "  Pruning unused containers, images, volumes, and networks..."));
    const data = await request("POST", "/api/system/prune");
    console.log(c("green", `  ✓ Reclaimed ${formatBytes(data.totalReclaimed)}`));
    console.log(c("dim", `    Containers: ${data.containers.deleted.length} removed`));
    console.log(c("dim", `    Images: ${(data.images.deleted || []).length} removed`));
    console.log(c("dim", `    Volumes: ${(data.volumes.deleted || []).length} removed`));
    console.log(c("dim", `    Networks: ${(data.networks.deleted || []).length} removed\n`));
  },

  async ssl() {
    const data = await request("GET", "/api/ssl");
    table(
      ["DOMAIN", "VALID", "DAYS LEFT", "ISSUER", "EXPIRES"],
      data.certificates.map((cert) => [
        cert.domain,
        cert.valid ? c("green", "✓") : c("red", "✗"),
        cert.daysRemaining <= 14 ? c("yellow", cert.daysRemaining + "d") : c("green", cert.daysRemaining + "d"),
        cert.issuer,
        cert.expiresAt?.split("T")[0] || "-",
      ])
    );
  },

  async endpoints() {
    const data = await request("GET", "/api/endpoints");
    table(
      ["", "ENDPOINT", "STATUS", "TIME"],
      data.endpoints.map((ep) => [
        ep.healthy ? c("green", "✓") : c("red", "✗"),
        ep.name,
        ep.status || "ERR",
        `${ep.responseTime}ms`,
      ])
    );
  },

  async maintenance(args) {
    if (args[0] === "on") {
      await request("POST", "/api/maintenance", { enabled: true });
      console.log(c("yellow", "  ⚠ Maintenance mode ENABLED — alerts paused"));
    } else if (args[0] === "off") {
      await request("POST", "/api/maintenance", { enabled: false });
      console.log(c("green", "  ✓ Maintenance mode DISABLED — alerts active"));
    } else {
      const data = await request("GET", "/api/maintenance");
      console.log(`  Maintenance mode: ${data.enabled ? c("yellow", "ENABLED") : c("green", "disabled")}`);
    }
  },

  async audit() {
    const data = await request("GET", "/api/audit?limit=20");
    for (const log of data.logs) {
      const time = new Date(log.created_at).toLocaleString();
      console.log(`  ${c("dim", time)} ${c("cyan", log.action)} ${log.target || ""} ${c("dim", log.detail || "")}`);
    }
  },

  help() {
    console.log(`
${c("bold", "Lagoon Cockpit CLI")} — Docker infrastructure management

${c("bold", "Connection:")}
  cockpit connect <url> <api-key> [name]   Connect to a server
  cockpit servers                           List configured servers
  cockpit use <name>                        Switch active server

${c("bold", "Overview:")}
  cockpit overview                          System dashboard
  cockpit ps [running|stopped]              List containers
  cockpit stacks                            List compose stacks

${c("bold", "Container Management:")}
  cockpit start <container>                 Start a container
  cockpit stop <container>                  Stop a container
  cockpit restart <container>               Restart a container
  cockpit logs <container> [--tail N]       View container logs
  cockpit logs <container> --search <q>     Search logs with regex
  cockpit exec <container> <command>        Run a command in a container

${c("bold", "Docker Resources:")}
  cockpit images                            List Docker images
  cockpit networks                          Show Docker networks
  cockpit disk                              Disk usage breakdown
  cockpit prune                             System prune (reclaim space)

${c("bold", "Monitoring:")}
  cockpit ssl                               SSL certificate status
  cockpit endpoints                         HTTP endpoint probes
  cockpit maintenance [on|off]              Toggle maintenance mode
  cockpit audit                             View activity log

${c("bold", "Config:")}
  cockpit help                              Show this help
`);
  },
};

async function containerAction(id, action) {
  if (!id) { console.log(`Usage: cockpit ${action} <container-id-or-name>`); return; }
  try {
    await request("POST", `/api/containers/${id}/${action}`);
    console.log(c("green", `  ✓ ${action}ed ${id}`));
  } catch (err) {
    console.error(c("red", `  ✗ ${err.message}`));
  }
}

function progressBar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const color = percent >= 90 ? "red" : percent >= 70 ? "yellow" : "green";
  return c(color, "█".repeat(filled)) + c("dim", "░".repeat(empty));
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    commands.help();
    return;
  }
  if (!commands[cmd]) {
    console.error(c("red", `Unknown command: ${cmd}`));
    console.log(c("dim", "Run 'cockpit help' for available commands"));
    process.exit(1);
  }
  try {
    await commands[cmd](args);
  } catch (err) {
    console.error(c("red", `Error: ${err.message}`));
    process.exit(1);
  }
}

main();
