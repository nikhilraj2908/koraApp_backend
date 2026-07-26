const Rider = require("../models/Rider");

/**
 * Finds online, available riders within radiusKm of a point, using the
 * 2dsphere index on Rider.currentLocation (added in Phase 1). Sorted
 * nearest-first by MongoDB itself (that's what $near guarantees) — no
 * further sorting needed by the caller.
 *
 * @param {[number, number]} coordinates - [lng, lat] centroid of the ride group
 * @param {number} radiusKm
 */
async function findNearbyAvailableRiders(coordinates, radiusKm) {
  return Rider.find({
    currentLocation: {
      $near: {
        $geometry: { type: "Point", coordinates },
        $maxDistance: radiusKm * 1000, // $maxDistance is in meters
      },
    },
    isOnline: true,
    isAvailable: true,
  }).lean();
}

module.exports = { findNearbyAvailableRiders };