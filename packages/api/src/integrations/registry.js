/**
 * Integration registry — discovers, loads, and manages adapter lifecycle.
 * Maintains the mapping of adapter type → adapter class.
 */

const registeredAdapters = new Map(); // adapterName -> AdapterClass

/**
 * Register an adapter type.
 * @param {string} name - Unique adapter name (e.g., "prometheus")
 * @param {typeof import("./adapter").BaseAdapter} AdapterClass
 */
function registerAdapter(name, AdapterClass) {
  if (registeredAdapters.has(name)) {
    console.warn(`[INTEGRATIONS] Adapter "${name}" already registered, overwriting`);
  }
  registeredAdapters.set(name, AdapterClass);
  console.log(`[INTEGRATIONS] Registered adapter: ${name}`);
}

/**
 * Get an adapter class by name.
 * @param {string} name
 * @returns {typeof import("./adapter").BaseAdapter | null}
 */
function getAdapterClass(name) {
  return registeredAdapters.get(name) || null;
}

/**
 * Create an adapter instance with the given config.
 * @param {string} adapterName
 * @param {object} config
 * @returns {import("./adapter").BaseAdapter | null}
 */
function createAdapterInstance(adapterName, config) {
  const AdapterClass = registeredAdapters.get(adapterName);
  if (!AdapterClass) return null;
  return new AdapterClass(config);
}

/**
 * List all registered adapter types with their config schemas.
 * @returns {Array<{ name: string, displayName: string, configSchema: object }>}
 */
function listAdapterTypes() {
  const types = [];
  for (const [name, AdapterClass] of registeredAdapters) {
    const instance = new AdapterClass({});
    types.push({
      name,
      displayName: instance.displayName || name,
      version: instance.version || "1.0.0",
      configSchema: AdapterClass.configSchema ? AdapterClass.configSchema() : {},
    });
  }
  return types;
}

/**
 * Check if an adapter type is registered.
 * @param {string} name
 * @returns {boolean}
 */
function hasAdapter(name) {
  return registeredAdapters.has(name);
}

module.exports = {
  registerAdapter,
  getAdapterClass,
  createAdapterInstance,
  listAdapterTypes,
  hasAdapter,
};
