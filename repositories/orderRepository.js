const Order = require("../models/Order");
const { ORDER_DISPATCH_STATUS } = require("../constants/dispatchConstants");

/**
 * All pending orders for a given slot + calendar date, ready to be
 * grouped. Only orders still in "awaiting_slot" are eligible — this is
 * what makes it safe to call this repeatedly (e.g. scheduler retry after
 * a crash) without re-grouping orders that already made it into a group.
 */
async function findPendingOrdersForSlot(pickupSlot, pickupDate) {
  return Order.find({
    pickupSlot,
    pickupDate,
    dispatchStatus: ORDER_DISPATCH_STATUS.AWAITING_SLOT,
    // Defensive: never pull in an order the customer already cancelled
    // between booking and slot start.
    status: { $ne: "cancelled" },
  }).lean();
}

/**
 * Atomically claims a batch of orders for grouping — flips them from
 * AWAITING_SLOT to GROUPING in one update, and returns how many were
 * actually claimed. This is what prevents two concurrent scheduler runs
 * (e.g. a slow first run overlapping a retry, or two server instances
 * both triggering on the same cron tick) from grouping the same order
 * twice: only the update that actually matched AWAITING_SLOT wins each
 * order, because the filter itself excludes anything already claimed.
 */
async function claimOrdersForGrouping(orderIds) {
  const result = await Order.updateMany(
    { _id: { $in: orderIds }, dispatchStatus: ORDER_DISPATCH_STATUS.AWAITING_SLOT },
    { $set: { dispatchStatus: ORDER_DISPATCH_STATUS.GROUPING } }
  );
  return result.modifiedCount;
}

/**
 * Marks a set of orders as belonging to a specific RideGroup.
 */
async function assignOrdersToGroup(orderIds, rideGroupId) {
  await Order.updateMany(
    { _id: { $in: orderIds } },
    { $set: { dispatchStatus: ORDER_DISPATCH_STATUS.GROUPED, rideGroupId } }
  );
}

/**
 * Rolls a claim back if grouping fails partway (e.g. route optimization
 * throws) — returns the orders to AWAITING_SLOT so the next scheduler
 * run picks them back up instead of leaving them stuck in GROUPING
 * forever.
 */
async function releaseOrdersBackToAwaitingSlot(orderIds) {
  await Order.updateMany(
    { _id: { $in: orderIds } },
    { $set: { dispatchStatus: ORDER_DISPATCH_STATUS.AWAITING_SLOT } }
  );
}

module.exports = {
  findPendingOrdersForSlot,
  claimOrdersForGrouping,
  assignOrdersToGroup,
  releaseOrdersBackToAwaitingSlot,
};