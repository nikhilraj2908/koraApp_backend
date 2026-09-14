const Washer = require("../models/Washer");

/**
 * Finds nearby, available, verified washers within radiusKm of a point,
 * using the 2dsphere index on Washer.shopLocation. Sorted nearest-first
 * by MongoDB ($near guarantees this ordering).
 *
 * @param {[number, number]} coordinates - [lng, lat] centroid of the order group
 * @param {number} radiusKm
 */
async function findNearbyAvailableWashers(coordinates, radiusKm) {
  return Washer.find({
    shopLocation: {
      $near: {
        $geometry: { type: "Point", coordinates },
        $maxDistance: radiusKm * 1000, // $maxDistance is in meters
      },
    },
    isAvailable: true,
    verificationStatus: "verified",
  })
    .select("_id name shopAddress expoPushToken shopLocation")
    .lean();
}

module.exports = { findNearbyAvailableWashers };
