const { dockerAPI } = require("./client");

/**
 * System-wide prune: containers, images, networks.
 * Volumes are NOT pruned by default (data loss risk).
 * @param {boolean} includeVolumes - Explicitly opt-in to volume prune
 */
async function systemPrune(includeVolumes = false) {
  const promises = [
    dockerAPI("POST", "/containers/prune").catch(() => ({})),
    dockerAPI("POST", "/images/prune").catch(() => ({})),
    dockerAPI("POST", "/networks/prune").catch(() => ({})),
  ];

  if (includeVolumes) {
    promises.push(dockerAPI("POST", "/volumes/prune").catch(() => ({})));
  }

  const results = await Promise.all(promises);
  const [containerPrune, imagePrune, networkPrune] = results;
  const volumePrune = includeVolumes ? results[3] : {};

  return {
    containers: {
      deleted: containerPrune.ContainersDeleted || [],
      spaceReclaimed: containerPrune.SpaceReclaimed || 0,
    },
    images: {
      deleted: imagePrune.ImagesDeleted || [],
      spaceReclaimed: imagePrune.SpaceReclaimed || 0,
    },
    volumes: {
      deleted: includeVolumes ? volumePrune.VolumesDeleted || [] : [],
      spaceReclaimed: includeVolumes ? volumePrune.SpaceReclaimed || 0 : 0,
      skipped: !includeVolumes,
    },
    networks: {
      deleted: networkPrune.NetworksDeleted || [],
    },
    totalReclaimed:
      (containerPrune.SpaceReclaimed || 0) +
      (imagePrune.SpaceReclaimed || 0) +
      (includeVolumes ? volumePrune.SpaceReclaimed || 0 : 0),
  };
}

module.exports = { systemPrune };
