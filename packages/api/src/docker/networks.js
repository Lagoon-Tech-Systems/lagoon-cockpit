const { dockerAPI } = require("./client");

/** List all Docker networks */
async function listNetworks() {
  const raw = await dockerAPI("GET", "/networks");
  return raw.map((n) => ({
    id: n.Id,
    name: n.Name,
    driver: n.Driver,
    scope: n.Scope,
    internal: n.Internal,
    containers: Object.entries(n.Containers || {}).map(([id, c]) => ({
      id,
      name: c.Name,
      ipv4: c.IPv4Address,
      ipv6: c.IPv6Address,
      mac: c.MacAddress,
    })),
    options: n.Options,
    created: n.Created,
  }));
}

/** Inspect a specific network */
async function inspectNetwork(id) {
  return dockerAPI("GET", `/networks/${id}`);
}

module.exports = { listNetworks, inspectNetwork };
