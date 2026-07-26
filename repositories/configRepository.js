const Configuration = require("../models/Configuration");
const { DEFAULT_CONFIG } = require("../constants/dispatchConstants");

// Read constantly by every grouping/pricing/scheduler call. A plain
// infinite in-process cache would go stale on OTHER instances when one
// instance updates config via the admin API (this system is required to
// support horizontal scaling) — so this uses a short TTL instead. Every
// instance re-reads from the DB at most once per TTL window, which is
// cheap (Configuration is a single small document) and means an admin's
// change propagates to all instances within a few seconds, without
// needing Redis pub/sub for cache invalidation.
const CACHE_TTL_MS = 5000;
let cachedConfig = null;
let cachedAt = 0;

/**
 * Returns the live Configuration document, seeding it from
 * DEFAULT_CONFIG on first boot if it doesn't exist yet.
 */
async function getConfig() {
  const isFresh = cachedConfig && Date.now() - cachedAt < CACHE_TTL_MS;
  if (isFresh) return cachedConfig;

  let config = await Configuration.findOne({ key: "default" });

  if (!config) {
    config = await Configuration.create({ key: "default", ...DEFAULT_CONFIG });
    console.log("[Configuration] Seeded default dispatch configuration.");
  }

  cachedConfig = config;
  cachedAt = Date.now();
  return config;
}

/**
 * Admin-facing update — merges a partial config object into the existing
 * one, validates via the schema, and invalidates this instance's cache
 * immediately (other instances pick it up within CACHE_TTL_MS).
 */
async function updateConfig(partialUpdate, updatedByAccountId) {
  const config = await Configuration.findOneAndUpdate(
    { key: "default" },
    { $set: { ...partialUpdate, updatedBy: updatedByAccountId } },
    { new: true, runValidators: true, upsert: true }
  );

  cachedConfig = config;
  cachedAt = Date.now();
  return config;
}

/**
 * Forces the next getConfig() call to hit the DB again. Useful after a
 * direct DB edit (e.g. via mongosh) outside the admin API.
 */
function invalidateConfigCache() {
  cachedConfig = null;
  cachedAt = 0;
}

module.exports = { getConfig, updateConfig, invalidateConfigCache };