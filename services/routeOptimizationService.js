/**
 * services/routeOptimizationService.js
 *
 * Turns a RideGroup's unordered set of 1-3 orders into the shortest
 * pickup sequence, using OSRM's real road-network distances (not
 * straight-line Haversine — accuracy matters here since this feeds
 * directly into the price/ETA shown to riders).
 *
 * Strategy:
 *   - n <= 6: exact brute-force over every permutation. With the default
 *     maxGroupSize of 3, that's at most 3! = 6 permutations (and since a
 *     reversed path has identical total distance, only 3 are actually
 *     distinct) — trivially cheap, and gives a GUARANTEED optimal route
 *     rather than a heuristic approximation.
 *   - n > 6: falls back to nearest-neighbor construction + 2-opt
 *     improvement. Only reachable if config.grouping.maxGroupSize is
 *     raised well beyond the spec's stated default of 3 — kept as a
 *     safety net so a config change doesn't silently make this function
 *     explode combinatorially (10! = 3.6M), not because it's expected to
 *     run in normal operation.
 */

const { getDistanceMatrix } = require("../utils/routeCalculator");

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

function routeDistance(sequenceIndices, distanceMatrix) {
  let total = 0;
  for (let i = 0; i < sequenceIndices.length - 1; i++) {
    total += distanceMatrix[sequenceIndices[i]][sequenceIndices[i + 1]];
  }
  return total;
}

/**
 * Guaranteed-optimal for small n — checks every permutation, keeps the
 * shortest. Reversed permutations have identical total distance for an
 * open path (no return-to-start), so roughly half the checks are
 * redundant, but at n<=6 this is still microseconds — not worth the
 * added complexity of deduplicating them.
 */
function exactOptimalOrder(indices, distanceMatrix) {
  const perms = permutations(indices);
  let best = perms[0];
  let bestDist = routeDistance(best, distanceMatrix);

  for (const perm of perms.slice(1)) {
    const dist = routeDistance(perm, distanceMatrix);
    if (dist < bestDist) {
      bestDist = dist;
      best = perm;
    }
  }

  return best;
}

/**
 * Nearest-neighbor construction: start from index 0, repeatedly jump to
 * the closest not-yet-visited point.
 */
function nearestNeighborOrder(indices, distanceMatrix) {
  const remaining = [...indices];
  const route = [remaining.shift()];

  while (remaining.length > 0) {
    const last = route[route.length - 1];
    let nearestIdx = 0;
    let nearestDist = Infinity;
    remaining.forEach((idx, i) => {
      const d = distanceMatrix[last][idx];
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    });
    route.push(remaining.splice(nearestIdx, 1)[0]);
  }

  return route;
}

/**
 * 2-opt local-search improvement: repeatedly try reversing segments of
 * the route, keep any reversal that shortens total distance, stop when
 * no single reversal helps anymore (local optimum).
 */
function twoOptImprove(route, distanceMatrix) {
  let improved = true;
  let best = [...route];
  let bestDist = routeDistance(best, distanceMatrix);

  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const candidateDist = routeDistance(candidate, distanceMatrix);
        if (candidateDist < bestDist) {
          best = candidate;
          bestDist = candidateDist;
          improved = true;
        }
      }
    }
  }

  return best;
}

/**
 * @param {Array<{ _id: any, pickupLocation: { coordinates: [number, number] } }>} orders
 * @returns {Promise<{
 *   sequence: any[],           // order _ids, in optimal pickup order
 *   totalDistanceMeters: number,
 *   totalDurationSeconds: number,
 *   legs: Array<{ fromOrderId: any, toOrderId: any, distanceMeters: number, durationSeconds: number }>
 * }>}
 */
async function optimizeRoute(orders) {
  if (!orders || orders.length === 0) {
    throw new Error("optimizeRoute requires at least 1 order");
  }

  if (orders.length === 1) {
    return {
      sequence: [orders[0]._id],
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      legs: [],
    };
  }

  const points = orders.map((o) => ({ coordinates: o.pickupLocation.coordinates }));
  const { distances, durations } = await getDistanceMatrix(points);

  const indices = orders.map((_, i) => i);
  const optimalIndices =
    orders.length <= 6
      ? exactOptimalOrder(indices, distances)
      : twoOptImprove(nearestNeighborOrder(indices, distances), distances);

  const legs = [];
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;

  for (let i = 0; i < optimalIndices.length - 1; i++) {
    const fromIdx = optimalIndices[i];
    const toIdx = optimalIndices[i + 1];
    const legDistance = distances[fromIdx][toIdx];
    const legDuration = durations[fromIdx][toIdx];

    legs.push({
      fromOrderId: orders[fromIdx]._id,
      toOrderId: orders[toIdx]._id,
      distanceMeters: legDistance,
      durationSeconds: legDuration,
    });

    totalDistanceMeters += legDistance;
    totalDurationSeconds += legDuration;
  }

  return {
    sequence: optimalIndices.map((i) => orders[i]._id),
    totalDistanceMeters,
    totalDurationSeconds,
    legs,
  };
}

module.exports = { optimizeRoute, exactOptimalOrder, nearestNeighborOrder, twoOptImprove };