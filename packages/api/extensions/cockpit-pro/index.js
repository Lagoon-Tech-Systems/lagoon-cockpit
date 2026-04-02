/**
 * Cockpit Pro — Extension entry point.
 * Registers all Pro modules with the CE extension system.
 */

const incidents = require("./incidents/routes");
const remediation = require("./remediation/routes");
const statusPages = require("./status-pages/routes");
const uptime = require("./uptime/routes");
const chatops = require("./chatops/routes");
const sla = require("./sla/routes");

module.exports = {
  name: "cockpit-pro",
  version: "1.0.0",

  // Public routes that bypass auth (mounted separately by extension loader)
  publicRoutes: null,

  init(router, services) {
    const { requireEdition } = require("./helpers/edition");

    // Each module gets (services) — db is available via services.db
    incidents.init(services);
    router.use("/incidents", requireEdition("incidents"), incidents.router);

    remediation.init(services);
    router.use("/remediation", requireEdition("remediation"), remediation.router);

    statusPages.init(services);
    router.use("/status-pages", requireEdition("status_pages"), statusPages.router);

    uptime.init(services);
    router.use("/uptime", requireEdition("uptime_monitoring"), uptime.router);

    chatops.init(services);
    router.use("/chatops", requireEdition("chatops"), chatops.router);

    sla.init(services);
    router.use("/sla", requireEdition("sla"), sla.router);

    // Expose public routes for mounting without auth
    this.publicRoutes = statusPages.publicRouter;

    console.log("[PRO] 6 modules registered");
  },
};
