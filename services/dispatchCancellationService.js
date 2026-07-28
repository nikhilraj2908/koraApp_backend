/**
 * services/dispatchCancellationService.js
 *
 * NOTE (current status): constants/dispatchConstants.js's
 * ALLOW_MID_PIPELINE_CANCELLATION is false (the Option A decision), so
 * controllers/orderController.js's cancelOrder blocks self-serve
 * cancellation for any order past dispatchStatus "awaiting_slot",
 * routing the customer to support instead — the "grouped" /
 * "offer_pending" / "assigned" branches in this file are currently
 * UNREACHABLE from that call site. This isn't dead code by accident:
 * it's kept in place, fully built and tested logic, for the day this
 * product decision is revisited (Option B — allow self-serve
 * cancellation further into the pipeline, with automatic
 * re-routing/re-offering/rider-notification). Flipping
 * ALLOW_MID_PIPELINE_CANCELLATION to true is the entire activation —
 * this file needs no changes when that happens.
 *
 * Handles the dispatch-pipeline side effects of a customer cancelling an
 * order — something the original cancelOrder controller had zero
 * awareness of. Without this, a cancelled order could still show up on
 * a rider's accepted pickup list, or keep a stale RideOffer broadcasting
 * a route/price that no longer matches reality.
 *
 * Call handleOrderCancellation(order) AFTER order.status has been set to
 * "cancelled" and saved — this only cleans up the dispatch side, it does
 * not touch refund/wallet logic (that stays in orderController.js).
 */

const RideGroup = require("../models/RideGroup");
const RideOffer = require("../models/RideOffer");
const Assignment = require("../models/Assignment");
const Rider = require("../models/Rider");

const { RIDE_GROUP_STATUS, RIDE_OFFER_STATUS, ASSIGNMENT_STATUS } = require("../constants/dispatchConstants");
const { optimizeRoute } = require("./routeOptimizationService");
const { notifyCustomer, sendPushNotification } = require("../utils/notification");

async function handleOrderCancellation(order) {
  // Not yet in the dispatch pipeline at all — nothing to clean up.
  if (!order.dispatchStatus || order.dispatchStatus === "awaiting_slot" || order.dispatchStatus === "grouping") {
    return;
  }

  if (order.dispatchStatus === "grouped" || order.dispatchStatus === "offer_pending") {
    await cleanupBeforeAssignment(order);
    return;
  }

  if (order.dispatchStatus === "assigned") {
    await cleanupAfterAssignment(order);
  }
}

/**
 * Order was clustered into a RideGroup, but no rider has accepted yet
 * (group is ROUTED or OFFERED). Pull the order out; if any orders remain,
 * re-route and re-offer them fresh rather than leaving a stale route/price
 * live. If none remain, the whole group is cancelled.
 */
async function cleanupBeforeAssignment(order) {
  if (!order.rideGroupId) return;

  const rideGroup = await RideGroup.findById(order.rideGroupId);
  if (!rideGroup || [RIDE_GROUP_STATUS.CANCELLED, RIDE_GROUP_STATUS.ASSIGNED].includes(rideGroup.status)) {
    return; // already resolved by something else — nothing to do
  }

  // A live offer's price/route was built from the OLD order set — it's
  // stale the moment one of those orders is cancelled. Expire it
  // immediately rather than letting riders keep bidding on a route that
  // no longer matches reality; a fresh offer gets created below if any
  // orders remain.
  const liveOffer = await RideOffer.findOne({ rideGroupId: rideGroup._id, status: RIDE_OFFER_STATUS.PENDING });
  if (liveOffer) {
    // Lazy require avoids a require cycle (auctionService also requires
    // this file's sibling concerns indirectly via groupingService).
    const { expireOffer } = require("./auctionService");
    await expireOffer(liveOffer._id, "cancelled");
  }

  const remainingOrderIds = rideGroup.orderIds.filter((id) => id.toString() !== order._id.toString());

  if (remainingOrderIds.length === 0) {
    rideGroup.orderIds = [];
    rideGroup.status = RIDE_GROUP_STATUS.CANCELLED;
    await rideGroup.save();
    console.log(`[DispatchCancellation] RideGroup ${rideGroup._id} cancelled — its only order was cancelled.`);
    return;
  }

  // Re-optimize and re-offer for whichever orders are left. Reuses the
  // exact same Order documents already loaded elsewhere would be nicer,
  // but a fresh minimal fetch keeps this function self-contained and
  // correct regardless of caller.
  const Order = require("../models/Order");
  const remainingOrders = await Order.find({ _id: { $in: remainingOrderIds } }).lean();

  rideGroup.orderIds = remainingOrderIds;
  rideGroup.totalClothQuantity = remainingOrders.reduce((sum, o) => sum + (o.clothQuantity || 0), 0);

  try {
    const optimizedRoute = await optimizeRoute(remainingOrders);
    rideGroup.optimizedRoute = optimizedRoute;
    rideGroup.status = RIDE_GROUP_STATUS.ROUTED;
    await rideGroup.save();

    const { createOfferForGroup } = require("./auctionService");
    await createOfferForGroup(rideGroup._id);

    console.log(`[DispatchCancellation] RideGroup ${rideGroup._id} re-routed and re-offered after a cancellation (${remainingOrderIds.length} order(s) remain).`);
  } catch (err) {
    // Leave it ROUTED-but-unoffered rather than crashing the cancellation
    // itself — the auction reconciliation job (jobs/auctionReconciliationJob.js)
    // will pick this back up and retry offer creation.
    rideGroup.status = RIDE_GROUP_STATUS.ROUTED;
    await rideGroup.save();
    console.error(`[DispatchCancellation] Failed to re-route/re-offer RideGroup ${rideGroup._id} after cancellation:`, err.message);
  }
}

/**
 * A rider has already committed to this pickup (Assignment exists). We
 * can't silently erase their trip — notify them so they don't waste a
 * visit, and release them back to available if this was their only
 * remaining order in the group.
 *
 * Deliberate simplification: this does NOT re-optimize the rider's
 * in-progress route for the remaining orders (they may already be
 * en route). That's a reasonable trade-off for a rider who's already
 * physically committed — full re-routing mid-trip is a further
 * enhancement, not a correctness bug like the "no cleanup at all"
 * state this replaces.
 */
async function cleanupAfterAssignment(order) {
  const assignment = await Assignment.findOne({
    orderIds: order._id,
    status: ASSIGNMENT_STATUS.ACTIVE,
  });

  if (!assignment) return;

  assignment.orderIds = assignment.orderIds.filter((id) => id.toString() !== order._id.toString());

  if (assignment.orderIds.length === 0) {
    assignment.status = ASSIGNMENT_STATUS.CANCELLED;
    assignment.cancelledAt = new Date();
    assignment.cancellationReason = "All orders in this assignment were cancelled by customers.";
    await assignment.save();

    await Rider.updateOne({ _id: assignment.riderId }, { $set: { isAvailable: true } });

    await RideGroup.updateOne(
      { _id: assignment.rideGroupId },
      { $set: { status: RIDE_GROUP_STATUS.CANCELLED } }
    );

    console.log(`[DispatchCancellation] Assignment ${assignment._id} fully cancelled — rider ${assignment.riderId} released.`);
  } else {
    await assignment.save();
  }

  const rider = await Rider.findById(assignment.riderId);
  if (rider?.expoPushToken) {
    await sendPushNotification(rider.expoPushToken, {
      title: "Pickup Cancelled",
      body: `Order ${order.orderNumber} was cancelled by the customer and removed from your pickup list.`,
      data: { orderNumber: order.orderNumber, type: "order_cancelled" },
    });
  }

  // The existing customer-facing notification system already fires
  // separately from orderController.cancelOrder for the customer
  // themselves — this function only handles the RIDER-facing side.
}

module.exports = { handleOrderCancellation };