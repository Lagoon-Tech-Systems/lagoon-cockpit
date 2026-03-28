const Ajv = require("ajv");

const ajv = new Ajv({ allErrors: false, coerceTypes: false, removeAdditional: false });

/**
 * Request body validation middleware using JSON Schema (ajv).
 * Returns 400 with schema errors if validation fails — never leaks internals.
 */

// --- Schemas for mutation endpoints ---

const schemas = {
  // Auth
  authToken: {
    type: "object",
    properties: {
      apiKey: { type: "string", minLength: 1, maxLength: 256 },
    },
    required: ["apiKey"],
    additionalProperties: false,
  },

  authLogin: {
    type: "object",
    properties: {
      email: { type: "string", format: "email", maxLength: 256 },
      password: { type: "string", minLength: 1, maxLength: 256 },
    },
    required: ["email", "password"],
    additionalProperties: false,
  },

  authRefresh: {
    type: "object",
    properties: {
      refreshToken: { type: "string", minLength: 1, maxLength: 512 },
    },
    required: ["refreshToken"],
    additionalProperties: false,
  },

  // User management
  createUser: {
    type: "object",
    properties: {
      email: { type: "string", format: "email", maxLength: 256 },
      password: { type: "string", minLength: 8, maxLength: 256 },
      role: { type: "string", enum: ["admin", "operator", "viewer"] },
    },
    required: ["email", "password", "role"],
    additionalProperties: false,
  },

  // Alert rules
  alertRule: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 128 },
      metric: { type: "string", minLength: 1, maxLength: 64 },
      operator: { type: "string", enum: [">", ">=", "<", "<=", "=="] },
      threshold: { type: "number" },
      duration_seconds: { type: "integer", minimum: 0, maximum: 86400 },
      enabled: { type: "boolean" },
    },
    required: ["name", "metric", "operator", "threshold"],
    additionalProperties: false,
  },

  // Webhooks
  webhook: {
    type: "object",
    properties: {
      url: { type: "string", maxLength: 2048 },
      events: { type: "array", items: { type: "string", maxLength: 64 }, maxItems: 20 },
      headers: { type: "object", additionalProperties: { type: "string" } },
      enabled: { type: "boolean" },
    },
    required: ["url", "events"],
    additionalProperties: false,
  },

  // Scheduled actions
  schedule: {
    type: "object",
    properties: {
      container_id: { type: "string", minLength: 1, maxLength: 128 },
      action: { type: "string", enum: ["start", "stop", "restart"] },
      cron: { type: "string", minLength: 1, maxLength: 128 },
      enabled: { type: "boolean" },
    },
    required: ["container_id", "action", "cron"],
    additionalProperties: false,
  },

  // Push notification registration
  pushRegister: {
    type: "object",
    properties: {
      token: { type: "string", minLength: 1, maxLength: 512 },
    },
    required: ["token"],
    additionalProperties: false,
  },

  // Container exec
  containerExec: {
    type: "object",
    properties: {
      command: { type: "string", minLength: 1, maxLength: 1024 },
    },
    required: ["command"],
    additionalProperties: false,
  },

  // Integration
  integration: {
    type: "object",
    properties: {
      adapter: { type: "string", minLength: 1, maxLength: 64 },
      name: { type: "string", minLength: 1, maxLength: 128 },
      config: { type: "object" },
      poll_interval: { type: "integer", minimum: 10, maximum: 86400 },
      enabled: { type: "boolean" },
    },
    required: ["adapter", "name", "config"],
    additionalProperties: false,
  },

  // License key
  licenseKey: {
    type: "object",
    properties: {
      key: { type: "string", minLength: 1, maxLength: 4096 },
    },
    required: ["key"],
    additionalProperties: false,
  },
};

// Pre-compile all validators
const validators = {};
for (const [name, schema] of Object.entries(schemas)) {
  validators[name] = ajv.compile(schema);
}

/**
 * Validate request body against a named schema.
 * @param {string} schemaName - Key from the schemas object
 * @returns Express middleware
 */
function validateBody(schemaName) {
  const validate = validators[schemaName];
  if (!validate) {
    throw new Error(`Unknown validation schema: ${schemaName}`);
  }

  return (req, res, next) => {
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }

    if (!validate(req.body)) {
      const firstError = validate.errors[0];
      const field = firstError.instancePath
        ? firstError.instancePath.slice(1)
        : firstError.params?.missingProperty || "body";
      return res.status(400).json({
        error: "Validation failed",
        field,
        message: firstError.message,
      });
    }

    next();
  };
}

module.exports = { validateBody, schemas };
