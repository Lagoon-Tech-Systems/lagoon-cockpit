const { dockerAPI } = require("./client");

/** List all images */
async function listImages() {
  const raw = await dockerAPI("GET", "/images/json", null, { query: { all: "false" } });
  return raw.map((img) => ({
    id: img.Id,
    repoTags: img.RepoTags || [],
    repoDigests: img.RepoDigests || [],
    created: img.Created,
    size: img.Size,
    virtualSize: img.VirtualSize,
    containers: img.Containers || 0,
    labels: img.Labels || {},
  }));
}

/** Remove an image */
async function removeImage(id, force = false) {
  return dockerAPI("DELETE", `/images/${id}`, null, {
    query: { force: force ? "true" : "false" },
  });
}

/** Prune unused images */
async function pruneImages(dangling = true) {
  return dockerAPI("POST", "/images/prune", null, {
    query: dangling ? { filters: JSON.stringify({ dangling: ["true"] }) } : {},
  });
}

module.exports = { listImages, removeImage, pruneImages };
