/**
 * helpers/geoHelper.js
 *
 * Straight-line (Haversine) distance — used for fast, in-memory order
 * clustering where checking hundreds of pairs against an external routing
 * API would be slow and costly. Real road-network distance (via OSRM) is
 * used later, in Phase 3, only for the final ~3-order route sequencing
 * within an already-formed group, where just a handful of pairs need it.
 */

const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * @param {[number, number]} coordsA - [lng, lat]
 * @param {[number, number]} coordsB - [lng, lat]
 * @returns {number} distance in meters
 */
function haversineDistanceMeters(coordsA, coordsB) {
  if (!Array.isArray(coordsA) || !Array.isArray(coordsB)) {
    throw new Error("haversineDistanceMeters requires [lng, lat] arrays for both points");
  }

  const [lng1, lat1] = coordsA;
  const [lng2, lat2] = coordsB;

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

function haversineDistanceKm(coordsA, coordsB) {
  return haversineDistanceMeters(coordsA, coordsB) / 1000;
}

module.exports = { haversineDistanceMeters, haversineDistanceKm };