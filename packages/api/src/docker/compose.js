const { listContainers, startContainer, stopContainer, restartContainer } = require("./containers");

/**
 * Discover compose stacks by grouping containers by their
 * `com.docker.compose.project` label.
 */
async function listStacks() {
  const containers = await listContainers(true);
  const stacks = {};

  for (const c of containers) {
    const project = c.composeProject;
    if (!project) continue;
    if (!stacks[project]) {
      stacks[project] = {
        name: project,
        containers: [],
        running: 0,
        stopped: 0,
        unhealthy: 0,
        workingDir: c.labels["com.docker.compose.project.working_dir"] || null,
      };
    }
    stacks[project].containers.push(c);
    if (c.state === "running") stacks[project].running++;
    else stacks[project].stopped++;
    if (c.health === "unhealthy") stacks[project].unhealthy++;
  }

  return Object.values(stacks).map((s) => ({
    name: s.name,
    containerCount: s.containers.length,
    running: s.running,
    stopped: s.stopped,
    unhealthy: s.unhealthy,
    status:
      s.unhealthy > 0
        ? "unhealthy"
        : s.stopped === s.containers.length
          ? "stopped"
          : s.running === s.containers.length
            ? "running"
            : "partial",
    workingDir: s.workingDir,
    containers: s.containers,
  }));
}

/** Get a single stack by name */
async function getStack(name) {
  const stacks = await listStacks();
  return stacks.find((s) => s.name === name) || null;
}

/** Start all containers in a stack */
async function startStack(name) {
  const stack = await getStack(name);
  if (!stack) throw new Error(`Stack "${name}" not found`);
  const results = [];
  for (const c of stack.containers) {
    if (c.state !== "running") {
      try {
        await startContainer(c.id);
        results.push({ id: c.id, name: c.name, action: "started" });
      } catch (err) {
        results.push({ id: c.id, name: c.name, action: "error", error: err.message });
      }
    } else {
      results.push({ id: c.id, name: c.name, action: "already_running" });
    }
  }
  return results;
}

/** Stop all containers in a stack */
async function stopStack(name) {
  const stack = await getStack(name);
  if (!stack) throw new Error(`Stack "${name}" not found`);
  const results = [];
  for (const c of stack.containers) {
    if (c.state === "running") {
      try {
        await stopContainer(c.id);
        results.push({ id: c.id, name: c.name, action: "stopped" });
      } catch (err) {
        results.push({ id: c.id, name: c.name, action: "error", error: err.message });
      }
    } else {
      results.push({ id: c.id, name: c.name, action: "already_stopped" });
    }
  }
  return results;
}

/** Restart all containers in a stack */
async function restartStack(name) {
  const stack = await getStack(name);
  if (!stack) throw new Error(`Stack "${name}" not found`);
  const results = [];
  for (const c of stack.containers) {
    try {
      await restartContainer(c.id);
      results.push({ id: c.id, name: c.name, action: "restarted" });
    } catch (err) {
      results.push({ id: c.id, name: c.name, action: "error", error: err.message });
    }
  }
  return results;
}

module.exports = { listStacks, getStack, startStack, stopStack, restartStack };
