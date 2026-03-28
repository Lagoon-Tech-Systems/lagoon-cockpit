const { hasFeature, requiredEdition: getRequiredEdition, FEATURE_EDITIONS } = require("./features");

/**
 * Edition gating middleware factory.
 * Returns 402 Payment Required if the current edition doesn't include the required feature(s).
 *
 * Usage:
 *   router.post("/api/incidents", requireAuth, requireEdition("incidents"), handler);
 */
function requireEdition(...features) {
  return (req, res, next) => {
    const edition = req.app.locals.edition;
    if (!edition) {
      return res.status(500).json({ error: "Edition not configured" });
    }

    for (const feature of features) {
      if (!hasFeature(edition.name, feature)) {
        return res.status(402).json({
          error: "Feature not available in your edition",
          feature,
          currentEdition: edition.name,
          requiredEdition: getRequiredEdition(feature),
          upgradeUrl: "https://lagoontechsystems.com/upgrade",
        });
      }
    }

    next();
  };
}

/**
 * Check a numeric limit for the current edition.
 * Returns { allowed: boolean, current: number, max: number }
 *
 * Usage:
 *   const check = checkLimit(req, "alertRules", currentRuleCount);
 *   if (!check.allowed) return res.status(402).json({ ... });
 */
function checkLimit(req, resource, currentCount) {
  const edition = req.app.locals.edition;
  if (!edition) return { allowed: true, current: currentCount, max: Infinity };

  // Private and enterprise have no limits
  if (edition.name === "private" || edition.name === "enterprise") {
    return { allowed: true, current: currentCount, max: Infinity };
  }

  const limits = edition.limits || {};
  const max = limits[resource];

  // If no limit defined for this resource, allow
  if (max === undefined || max === null) {
    return { allowed: true, current: currentCount, max: Infinity };
  }

  return {
    allowed: currentCount < max,
    current: currentCount,
    max,
  };
}

/**
 * Middleware that checks a limit and returns 402 if exceeded.
 * @param {string} resource - Limit key (e.g., "alertRules", "webhooks")
 * @param {Function} countFn - Function that returns the current count
 */
function requireLimit(resource, countFn) {
  return (req, res, next) => {
    const count = typeof countFn === "function" ? countFn(req) : countFn;
    const check = checkLimit(req, resource, count);

    if (!check.allowed) {
      return res.status(402).json({
        error: `Limit reached for ${resource}`,
        current: check.current,
        max: check.max,
        currentEdition: req.app.locals.edition?.name || "ce",
        upgradeUrl: "https://lagoontechsystems.com/upgrade",
      });
    }

    next();
  };
}

module.exports = { requireEdition, checkLimit, requireLimit };
