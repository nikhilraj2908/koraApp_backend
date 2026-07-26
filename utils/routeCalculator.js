const axios = require('axios');

const getDistanceAndDuration = async (origin, destination) => {
  const [lon1, lat1] = origin.coordinates;
  const [lon2, lat2] = destination.coordinates;
  const url = `${process.env.OSRM_URL}/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
  const res = await axios.get(url);
  const data = res.data.routes[0];
  return { distance: data.distance, duration: data.duration }; // meters, seconds
};

/**
 * Full pairwise distance/duration matrix for N points in a single OSRM
 * request, using the /table service — used by route optimization
 * (services/routeOptimizationService.js) to compare every possible
 * pickup ordering within a group without making N² separate /route
 * calls. Groups are capped at 3 orders by default, so this is always a
 * tiny 2x2 or 3x3 matrix — cheap even on the public OSRM demo server.
 *
 * @param {Array<{coordinates: [number, number]}>} points - [lng, lat] each
 * @returns {Promise<{ distances: number[][], durations: number[][] }>}
 *   distances[i][j] = meters from points[i] to points[j]
 *   durations[i][j] = seconds from points[i] to points[j]
 */
const getDistanceMatrix = async (points) => {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('getDistanceMatrix requires at least 2 points');
  }

  const coordString = points
    .map((p) => `${p.coordinates[0]},${p.coordinates[1]}`)
    .join(';');

  const url = `${process.env.OSRM_URL}/table/v1/driving/${coordString}?annotations=distance,duration`;
  const res = await axios.get(url);

  if (res.data.code !== 'Ok') {
    throw new Error(`OSRM table request failed: ${res.data.code}`);
  }

  return {
    distances: res.data.distances,
    durations: res.data.durations,
  };
};

module.exports = { getDistanceAndDuration, getDistanceMatrix };