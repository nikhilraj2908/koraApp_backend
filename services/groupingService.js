/**
 * services/groupingService.js
 *
 * Orchestrates turning "N pending orders for slot X" into a set of
 * RideGroups: decides group SIZES (groupSizeService, geography-blind),
 * then decides WHICH specific orders go in which group (this file,
 * geography-aware).
 *
 * Clustering approach: greedy nearest-neighbor with a fixed size target
 * per group.
 *   1. Process the largest group sizes first (lets bigger groups claim
 *      their tightest local cluster before smaller groups are left
 *      picking from scattered leftovers).
 *   2. Seed each group with whichever remaining order is FARTHEST from
 *      the centroid of all remaining orders — this peels off geographic
 *      outliers early, rather than leaving an isolated order to be
 *      forced into a distant group last.
 *   3. Fill the rest of that group with the nearest remaining orders to
 *      the seed, until the target size is reached.
 *
 * This is deterministic and O(groups x remaining) — genuinely fast at
 * the scale described (tens to low hundreds of orders per slot per
 * city). It is NOT a globally-optimal clustering (that's an NP-hard
 * capacitated clustering problem); for typical real-world address
 * distributions (a few dense areas, occasional outliers) it produces
 * tight, sensible groups. If you later see poor grouping quality in
 * practice, the next step up is DBSCAN for initial density-based
 * clusters, then a similar nearest-neighbor pass to split/merge those
 * into fixed sizes — flagging this as a documented upgrade path rather
 * than building it speculatively now.
 */

const { haversineDistanceMeters } = require("../helpers/geoHelper");
const { computeGroupSizePlan } = require("./groupSizeService");
const { getConfig } = require("../repositories/configRepository");
const orderRepository = require("../repositories/orderRepository");
const rideGroupRepository = require("../repositories/ridegroupRepository");
const Order = require("../models/Order");

function computeCentroid(orders) {
  const n = orders.length;
  const sum = orders.reduce(
    (acc, o) => {
      const [lng, lat] = o.pickupLocation.coordinates;
      return [acc[0] + lng, acc[1] + lat];
    },
    [0, 0]
  );
  return [sum[0] / n, sum[1] / n];
}

function closestPairIndices(orders) {
  let bestI = 0;
  let bestJ = 1;
  let bestDist = Infinity;

  for (let i = 0; i < orders.length; i++) {
    for (let j = i + 1; j < orders.length; j++) {
      const d = haversineDistanceMeters(
        orders[i].pickupLocation.coordinates,
        orders[j].pickupLocation.coordinates
      );
      if (d < bestDist) {
        bestDist = d;
        bestI = i;
        bestJ = j;
      }
    }
  }

  return [bestI, bestJ];
}

function indexOfNearest(orders, point) {
  let nearestIdx = 0;
  let nearestDist = Infinity;
  orders.forEach((o, i) => {
    const d = haversineDistanceMeters(o.pickupLocation.coordinates, point);
    if (d < nearestDist) {
      nearestDist = d;
      nearestIdx = i;
    }
  });
  return nearestIdx;
}

/**
 * Pure clustering function — no DB access, easy to unit test in
 * isolation. Takes plain order-like objects (must have pickupLocation)
 * and a size plan, returns an array of order-arrays matching those sizes.
 *
 * Seeding strategy: each group starts from the globally CLOSEST PAIR
 * among the still-unassigned orders (not a single "farthest from
 * centroid" point) — this matters. An earlier version seeded from the
 * point farthest from centroid to "peel off outliers early", but that
 * backfires: an isolated pair of nearby orders (an outlier micro-cluster)
 * would get seeded first, and since it only has 2 natural members, filling
 * a target size of 3 forced it to reach out and steal a member from a
 * DIFFERENT, much tighter cluster elsewhere — actively producing worse
 * groups than necessary. Closest-pair seeding, combined with filling
 * toward the group's growing centroid (not a fixed seed point), keeps
 * each group anchored to its own local density as it grows and only
 * reaches farther when the plan's size genuinely can't be satisfied
 * locally — which is the best a greedy heuristic can do; this remains an
 * NP-hard capacitated-clustering problem in general.
 */
function clusterOrdersBySizePlan(orders, sizePlan) {
  const remaining = [...orders];
  const groups = [];

  const sortedSizes = [...sizePlan].sort((a, b) => b - a);

  for (const targetSize of sortedSizes) {
    if (remaining.length === 0) break;

    let group;

    if (remaining.length === 1) {
      group = remaining.splice(0, 1);
    } else {
      const [i, j] = closestPairIndices(remaining);
      // Splice the larger index first so removing it doesn't shift the
      // position of the smaller index still to be removed.
      const first = remaining.splice(Math.max(i, j), 1)[0];
      const second = remaining.splice(Math.min(i, j), 1)[0];
      group = [first, second];

      while (group.length < targetSize && remaining.length > 0) {
        const groupCentroid = computeCentroid(group);
        const nearestIdx = indexOfNearest(remaining, groupCentroid);
        group.push(remaining.splice(nearestIdx, 1)[0]);
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * Full pipeline for one slot+date: claim pending orders, cluster them,
 * and persist RideGroups. Called by the scheduler job (Phase 4) when a
 * slot starts, but safe to call manually/via an admin endpoint too.
 *
 * Returns the created RideGroup documents.
 */
async function runGroupingForSlot(pickupSlot, pickupDate) {
  const pendingOrders = await orderRepository.findPendingOrdersForSlot(pickupSlot, pickupDate);

  if (pendingOrders.length === 0) {
    console.log(`[Grouping] No pending orders for ${pickupSlot} ${pickupDate.toDateString()}.`);
    return [];
  }

  // Only orders with a valid geo point can be clustered at all — filter
  // out anything malformed rather than letting one bad record crash the
  // whole slot's grouping run for every other customer.
  const groupable = pendingOrders.filter(
    (o) => o.pickupLocation?.coordinates?.length === 2
  );
  const ungroupable = pendingOrders.filter((o) => !groupable.includes(o));

  if (ungroupable.length > 0) {
    console.error(
      `[Grouping] ${ungroupable.length} order(s) skipped — missing/invalid pickupLocation:`,
      ungroupable.map((o) => o._id.toString())
    );
  }

  if (groupable.length === 0) return [];

  // Atomically claim before doing any work — see orderRepository's
  // comment for why this specifically prevents double-grouping under
  // concurrent scheduler runs.
  const claimedCount = await orderRepository.claimOrdersForGrouping(
    groupable.map((o) => o._id)
  );

  if (claimedCount === 0) {
    // Someone else (a concurrent run) already claimed all of these.
    console.log(`[Grouping] All eligible orders for ${pickupSlot} ${pickupDate.toDateString()} were already claimed by another run.`);
    return [];
  }

  // Re-fetch only what THIS run actually claimed, in case another
  // concurrent run grabbed some of them first — claimedCount may be
  // less than groupable.length if a race occurred, so re-check
  // authoritative DB state rather than assume all of them succeeded.
  const trulyClaimedIds = await Order.find(
    { _id: { $in: groupable.map((o) => o._id) }, dispatchStatus: "grouping" },
    { _id: 1 }
  ).lean();
  const trulyClaimedIdSet = new Set(trulyClaimedIds.map((o) => o._id.toString()));
  const ordersToGroup = groupable.filter((o) => trulyClaimedIdSet.has(o._id.toString()));

  if (ordersToGroup.length === 0) return [];

  const config = await getConfig();
  const sizePlan = computeGroupSizePlan(ordersToGroup.length, config.grouping.maxGroupSize);
  const clusters = clusterOrdersBySizePlan(ordersToGroup, sizePlan);

  const createdGroups = [];

  for (const clusterOrders of clusters) {
    try {
      const orderIds = clusterOrders.map((o) => o._id);
      const totalClothQuantity = clusterOrders.reduce((sum, o) => sum + (o.clothQuantity || 0), 0);

      const rideGroup = await rideGroupRepository.createRideGroup({
        pickupSlot,
        pickupDate,
        orderIds,
        totalClothQuantity,
      });

      await orderRepository.assignOrdersToGroup(orderIds, rideGroup._id);
      createdGroups.push(rideGroup);
    } catch (err) {
      // Don't let one bad cluster (e.g. a DB hiccup) take down every
      // other cluster in this slot — release just this cluster's orders
      // back to AWAITING_SLOT so the next run retries them, and continue.
      console.error("[Grouping] Failed to create RideGroup for cluster:", err.message);
      await orderRepository.releaseOrdersBackToAwaitingSlot(clusterOrders.map((o) => o._id));
    }
  }

  console.log(
    `[Grouping] ${pickupSlot} ${pickupDate.toDateString()}: ${ordersToGroup.length} orders -> ${createdGroups.length} groups (plan: ${sizePlan.join(",")}).`
  );

  return createdGroups;
}

module.exports = {
  clusterOrdersBySizePlan, // exported for unit testing in isolation
  runGroupingForSlot,
};