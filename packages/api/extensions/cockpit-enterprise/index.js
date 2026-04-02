/**
 * Cockpit Enterprise — Extension entry point.
 * Registers all Enterprise modules with the CE extension system.
 *
 * Each module exports a create() factory that returns { init, router }.
 * This avoids module-scoped singleton state and allows multiple independent
 * instances (e.g. for parallel test suites with separate DBs).
 */

const ssoMod = require("./sso/routes");
const whiteLabelMod = require("./white-label/routes");
const customRolesMod = require("./custom-roles/routes");
const ipAllowlistMod = require("./ip-allowlist/routes");
const mtlsMod = require("./mtls/routes");
const encryptionMod = require("./encryption/routes");
const complianceMod = require("./compliance/routes");

module.exports = {
  name: "cockpit-enterprise",
  version: "1.0.0",

  init(router, services) {
    const { requireEdition } = require("./helpers/edition");

    const sso = ssoMod.create();
    sso.init(services);
    router.use("/sso", requireEdition("sso_saml"), sso.router);

    const whiteLabel = whiteLabelMod.create();
    whiteLabel.init(services);
    router.use("/branding", requireEdition("white_label"), whiteLabel.router);

    const customRoles = customRolesMod.create();
    customRoles.init(services);
    router.use("/roles", requireEdition("custom_roles"), customRoles.router);

    const ipAllowlist = ipAllowlistMod.create();
    ipAllowlist.init(services);
    router.use("/ip-allowlist", requireEdition("ip_allowlist"), ipAllowlist.router);

    const mtls = mtlsMod.create();
    mtls.init(services);
    router.use("/mtls", requireEdition("mtls"), mtls.router);

    const encryption = encryptionMod.create();
    encryption.init(services);
    router.use("/encryption", requireEdition("encryption_at_rest"), encryption.router);

    const compliance = complianceMod.create();
    compliance.init(services);
    router.use("/compliance", requireEdition("compliance_logging"), compliance.router);

    console.log("[ENTERPRISE] 7 modules registered");
  },
};
