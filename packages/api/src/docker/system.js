const { dockerAPI } = require("./client");

/** Get Docker system info */
async function getDockerInfo() {
  return dockerAPI("GET", "/info");
}

/** Get Docker disk usage */
async function getDockerDiskUsage() {
  return dockerAPI("GET", "/system/df");
}

module.exports = { getDockerInfo, getDockerDiskUsage };
