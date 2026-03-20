const { dockerAPI } = require("./client");

/**
 * System-wide prune: containers, images, volumes, networks.
 * Returns bytes reclaimed from each category.
 */
async function systemPrune() {
  const [containerPrune, imagePrune, volumePrune, networkPrune] = await Promise.all([
    dockerAPI("POST", "/containers/prune").catch(() => ({})),
    dockerAPI("POST", "/images/prune").catch(() => ({})),
    dockerAPI("POST", "/volumes/prune").catch(() => ({})),
    dockerAPI("POST", "/networks/prune").catch(() => ({})),
  ]);

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
      deleted: volumePrune.VolumesDeleted || [],
      spaceReclaimed: volumePrune.SpaceReclaimed || 0,
    },
    networks: {
      deleted: networkPrune.NetworksDeleted || [],
    },
    totalReclaimed:
      (containerPrune.SpaceReclaimed || 0) +
      (imagePrune.SpaceReclaimed || 0) +
      (volumePrune.SpaceReclaimed || 0),
  };
}

module.exports = { systemPrune };
