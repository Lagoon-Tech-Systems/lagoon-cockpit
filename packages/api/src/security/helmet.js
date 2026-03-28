const helmet = require("helmet");

/**
 * Security headers middleware via helmet.
 * Configured for an API server (no HTML rendering, strict transport).
 */
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    noSniff: true,
    referrerPolicy: { policy: "no-referrer" },
    xFrameOptions: { action: "deny" },
    xPoweredBy: false,
  });
}

module.exports = { securityHeaders };
