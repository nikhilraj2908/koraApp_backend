/**
 * services/groupSizeService.js
 *
 * Pure function: given a count of pending orders, decides how many
 * groups to form and of what sizes — completely independent of WHERE
 * those orders are (that's groupingService.js's job, which assigns
 * specific orders to the slots this function hands back).
 *
 * Derived from, and verified exactly against, every example given:
 *   10 -> 3,3,2,2      6 -> 3,3
 *   11 -> 3,3,3,2      5 -> 3,2
 *    9 -> 3,3,3        4 -> 2,2
 *    8 -> 3,3,2        3 -> 3
 *    7 -> 3,2,2        2 -> 2
 *                       1 -> 1  (unavoidable — nothing to pair it with)
 *
 * The pattern: never leave a single lonely order if it can be avoided.
 * With max group size 3, a remainder of 1 order is "unpacked" — instead
 * of (q-1) groups of 3 + a group of 1, take one group of 3 away and
 * split it plus the leftover into two groups of 2 (3 + 1 = 2 + 2).
 *
 * NOTE: this exact rebalancing rule is derived specifically for
 * maxGroupSize = 3 (the spec's stated default). If config.grouping
 * .maxGroupSize is ever changed to something else, this falls back to
 * plain greedy chunking (no singleton-avoidance rebalancing) — that
 * finer rule wasn't specified for other max sizes, so we don't guess at
 * generalizing it silently.
 */

function computeGroupSizePlan(orderCount, maxGroupSize = 3) {
  if (orderCount <= 0) return [];

  if (maxGroupSize !== 3) {
    return greedyChunk(orderCount, maxGroupSize);
  }

  if (orderCount === 1) return [1]; // unavoidable — spec's own stated exception

  const q = Math.floor(orderCount / 3);
  const r = orderCount % 3;

  if (r === 0) {
    return Array(q).fill(3);
  }

  if (r === 2) {
    return [...Array(q).fill(3), 2];
  }

  // r === 1
  // q is guaranteed >= 1 here because orderCount === 1 was already
  // handled above as its own case (the only way to get q === 0 with r === 1).
  return [...Array(q - 1).fill(3), 2, 2];
}

/**
 * Fallback for any maxGroupSize other than 3 — simple greedy chunking,
 * no singleton-avoidance beyond what falls out naturally.
 */
function greedyChunk(orderCount, maxGroupSize) {
  const sizes = [];
  let remaining = orderCount;
  while (remaining > 0) {
    const size = Math.min(maxGroupSize, remaining);
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

module.exports = { computeGroupSizePlan };