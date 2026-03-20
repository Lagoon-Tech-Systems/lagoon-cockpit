const { dockerAPI } = require("./client");

/** List all Docker volumes */
async function listVolumes() {
  const raw = await dockerAPI("GET", "/volumes");
  return (raw.Volumes || []).map((v) => ({
    name: v.Name,
    driver: v.Driver,
    mountpoint: v.Mountpoint,
    scope: v.Scope,
    created: v.CreatedAt,
    labels: v.Labels || {},
  }));
}

/** Remove a volume */
async function removeVolume(name, force = false) {
  await dockerAPI("DELETE", `/volumes/${name}`, null, {
    query: { force: force ? "true" : "false" },
  });
}

/** Prune unused volumes */
async function pruneVolumes() {
  return dockerAPI("POST", "/volumes/prune");
}

module.exports = { listVolumes, removeVolume, pruneVolumes };
