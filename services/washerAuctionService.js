/**
 * services/washerAuctionService.js
 *
 * Manages the full lifecycle of a WasherGroupOffer:
 *
 *   1. createWasherOffer(rideGroupId)
 *      - Finds nearby verified washers from RideGroup's centroid
 *      - Creates a WasherGroupOffer document
 *      - Emits `washer_group_offer_created` socket event to each washer's
 *        personal room and sends Expo push notifications
 *      - Schedules an expiry timer (responseWindowSeconds from config)
 *
 *   2. acceptWasherOffer(washerGroupOfferId, washerId)
 *      - Atomically marks the offer ACCEPTED using findOneAndUpdate with
 *        `status: "pending"` guard — only one washer can win per group
 *      - Assigns washer to RideGroup + all constituent orders
 *      - Broadcasts `washer_group_offer_resolved` to all notified washers
 *      - Auto-triggers the rider auction for this group
 *
 *   3. expireWasherOffer(washerGroupOfferId)
 *      - Marks offer EXPIRED, broadcasts expiry event
 *      - TODO: retry logic (re-broadcast with larger radius, or notify admin)
 */

const mongoose = require("mongoose");
const WasherGroupOffer = require("../models/WasherGroupOffer");
const RideGroup = require("../models/RideGroup");
const Order = require("../models/Order");
const { findNearbyAvailableWashers } = require("../repositories/washerRepository");
const { getConfig } = require("../repositories/configRepository");
const { WASHER_GROUP_OFFER_STATUS, RIDE_GROUP_STATUS, ORDER_DISPATCH_STATUS } = require("../constants/dispatchConstants");
const { notifyWasher, notifyCustomer } = require("../utils/notification");

// In-memory timer map — survives normal operation; reconciliation cron
// (cronJobs.js) handles any timers lost on restart.
const activeTimers = new Map();

// ─────────────────────────────────────────────────────────────
// 1. CREATE WASHER OFFER
// ─────────────────────────────────────────────────────────────

/**
 * Creates a WasherGroupOffer for the given RideGroup and broadcasts it to
 * all nearby available verified washers.
 *
 * @param {string|ObjectId} rideGroupId
 */
async function createWasherOffer(rideGroupId) {
  const config = await getConfig();
  const rideGroup = await RideGroup.findById(rideGroupId).populate("orderIds").lean();

  if (!rideGroup) throw new Error(`createWasherOffer: RideGroup ${rideGroupId} not found`);
  if (rideGroup.status === RIDE_GROUP_STATUS.WASHER_OFFER_PENDING) {
    console.log(`[WasherAuction] Group ${rideGroupId} already has a live offer — skipping duplicate.`);
    return;
  }

  // Compute centroid of all orders' pickup locations for the proximity search.
  const coords = rideGroup.orderIds.map((o) => o.pickupLocation.coordinates);
  const centroid = [
    coords.reduce((s, c) => s + c[0], 0) / coords.length,
    coords.reduce((s, c) => s + c[1], 0) / coords.length,
  ];

  const radiusKm = config.washerDiscovery?.radiusKm ?? 10;
  const windowSec = config.washerAuction?.responseWindowSeconds ?? 120;

  const nearbyWashers = await findNearbyAvailableWashers(centroid, radiusKm);

  if (nearbyWashers.length === 0) {
    console.warn(`[WasherAuction] No nearby washers for group ${rideGroupId} within ${radiusKm}km. Will retry on next cron.`);
    return;
  }

  const expiresAt = new Date(Date.now() + windowSec * 1000);
  const optimizedRoute = rideGroup.optimizedRoute || {};

  const offer = await WasherGroupOffer.create({
    rideGroupId,
    pickupSequence: optimizedRoute.sequence || rideGroup.orderIds.map((o) => o._id),
    totalDistanceMeters: optimizedRoute.totalDistanceMeters || 0,
    totalDurationSeconds: optimizedRoute.totalDurationSeconds || 0,
    totalClothQuantity: rideGroup.totalClothQuantity || 0,
    orderCount: rideGroup.orderIds.length,
    notifiedWasherIds: nearbyWashers.map((w) => w._id),
    expiresAt,
  });

  // Update RideGroup status + link the offer
  await RideGroup.findByIdAndUpdate(rideGroupId, {
    status: RIDE_GROUP_STATUS.WASHER_OFFER_PENDING,
    washerGroupOfferId: offer._id,
  });

  // Update each order's dispatch status
  await Order.updateMany(
    { _id: { $in: rideGroup.orderIds.map((o) => o._id) } },
    {
      $set: { dispatchStatus: ORDER_DISPATCH_STATUS.WASHER_OFFER_PENDING, status: "washer_offer_pending" },
      $push: { statusHistory: { status: "washer_offer_pending", timestamp: new Date() } },
    }
  );

  // ── Socket broadcast + push notifications ──
  const { emitWasherGroupOffer } = _getSocketHelpers();
  const offerPayload = _buildOfferPayload(offer, rideGroup);

  for (const washer of nearbyWashers) {
    // Socket event to the washer's personal room (washer_<id>)
    emitWasherGroupOffer(String(washer._id), offerPayload);

    // Expo push notification (best-effort)
    await notifyWasher(washer._id, {
      title: "🧺 New Order Group Available!",
      body: `${offer.orderCount} order${offer.orderCount > 1 ? "s" : ""} near you — tap to accept`,
      data: { type: "washer_group_offer", offerId: String(offer._id) },
    });
  }

  // ── Schedule expiry timer ──
  const timerId = setTimeout(async () => {
    activeTimers.delete(String(offer._id));
    await expireWasherOffer(offer._id);
  }, windowSec * 1000);

  activeTimers.set(String(offer._id), timerId);

  console.log(`[WasherAuction] Offer ${offer._id} sent to ${nearbyWashers.length} washer(s), expires in ${windowSec}s`);
  return offer;
}

// ─────────────────────────────────────────────────────────────
// 2. ACCEPT WASHER OFFER (atomic)
// ─────────────────────────────────────────────────────────────

/**
 * Atomically accepts a WasherGroupOffer. Returns the updated offer on success,
 * or null if the offer was already taken or expired.
 *
 * @param {string|ObjectId} washerGroupOfferId
 * @param {string|ObjectId} washerId
 */
async function acceptWasherOffer(washerGroupOfferId, washerId) {
  const session = await mongoose.startSession();

  try {
    let acceptedOffer = null;

    await session.withTransaction(async () => {
      // ── Atomic claim: only succeeds if still PENDING ──
      acceptedOffer = await WasherGroupOffer.findOneAndUpdate(
        { _id: washerGroupOfferId, status: WASHER_GROUP_OFFER_STATUS.PENDING },
        {
          $set: {
            status: WASHER_GROUP_OFFER_STATUS.ACCEPTED,
            acceptedByWasherId: washerId,
            acceptedAt: new Date(),
          },
        },
        { new: true, session }
      );

      if (!acceptedOffer) {
        // Another washer already claimed it — abort the transaction.
        return; // withTransaction rolls back automatically
      }

      // ── Assign washer to RideGroup ──
      await RideGroup.findByIdAndUpdate(
        acceptedOffer.rideGroupId,
        {
          $set: {
            status: RIDE_GROUP_STATUS.WASHER_ASSIGNED,
            assignedWasherId: washerId,
          },
        },
        { session }
      );

      // ── Update each order to washer_assigned ──
      await Order.updateMany(
        { rideGroupId: acceptedOffer.rideGroupId },
        {
          $set: {
            status: "washer_assigned",
            serviceProviderId: washerId,
            dispatchStatus: ORDER_DISPATCH_STATUS.WASHER_ASSIGNED,
          },
          $push: { statusHistory: { status: "washer_assigned", timestamp: new Date() } },
        },
        { session }
      );
    });

    if (!acceptedOffer) {
      return null; // offer already resolved
    }

    // ── Clear the expiry timer (no longer needed) ──
    const timer = activeTimers.get(String(washerGroupOfferId));
    if (timer) {
      clearTimeout(timer);
      activeTimers.delete(String(washerGroupOfferId));
    }

    // ── Broadcast resolution to ALL notified washers ──
    const { emitWasherGroupOfferResolved } = _getSocketHelpers();
    const resolvedPayload = {
      offerId: String(acceptedOffer._id),
      rideGroupId: String(acceptedOffer.rideGroupId),
      acceptedByWasherId: String(washerId),
    };
    for (const wId of acceptedOffer.notifiedWasherIds) {
      emitWasherGroupOfferResolved(String(wId), resolvedPayload);
    }

    // ── Notify customers that a washer has been assigned ──
    const orders = await Order.find({ rideGroupId: acceptedOffer.rideGroupId })
      .select("customerId orderNumber _id")
      .lean();

    for (const order of orders) {
      await notifyCustomer(order.customerId, {
        title: "Washer Assigned 🧺",
        body: `Great news! A washer has been assigned to your order ${order.orderNumber}.`,
        type: "washer_assigned",
        orderId: order._id,
        orderNumber: order.orderNumber,
      });
    }

    // ── Auto-trigger rider auction for this group ──
    // Lazy require to avoid circular dependency
    const { createOfferForGroup } = require("./auctionService");
    setImmediate(async () => {
      try {
        await createOfferForGroup(String(acceptedOffer.rideGroupId));
        console.log(`[WasherAuction] Rider auction auto-started for group ${acceptedOffer.rideGroupId}`);
      } catch (err) {
        console.error(`[WasherAuction] Failed to start rider auction for group ${acceptedOffer.rideGroupId}:`, err.message);
      }
    });

    console.log(`[WasherAuction] Offer ${washerGroupOfferId} accepted by washer ${washerId}`);
    return acceptedOffer;

  } finally {
    await session.endSession();
  }
}

// ─────────────────────────────────────────────────────────────
// 3. EXPIRE WASHER OFFER
// ─────────────────────────────────────────────────────────────

/**
 * Expires a WasherGroupOffer that has timed out. Broadcasts the expiry event
 * to all notified washers so their UIs can dismiss the offer card.
 *
 * @param {string|ObjectId} washerGroupOfferId
 * @param {"expired"|"cancelled"} reason
 */
async function expireWasherOffer(washerGroupOfferId, reason = "expired") {
  const offer = await WasherGroupOffer.findOneAndUpdate(
    { _id: washerGroupOfferId, status: WASHER_GROUP_OFFER_STATUS.PENDING },
    { $set: { status: reason } },
    { new: true }
  );

  if (!offer) return; // already resolved — nothing to do

  console.warn(`[WasherAuction] Offer ${washerGroupOfferId} ${reason} — no washer accepted in time.`);

  const { emitWasherGroupOfferExpired } = _getSocketHelpers();
  const payload = {
    offerId: String(offer._id),
    rideGroupId: String(offer.rideGroupId),
    reason,
  };
  for (const wId of offer.notifiedWasherIds) {
    emitWasherGroupOfferExpired(String(wId), payload);
  }

  // TODO: retry with expanded radius, or notify admin for manual assignment
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function _getSocketHelpers() {
  try {
    return require("../socket/trackingSocket");
  } catch {
    // Socket not initialized (e.g. during unit tests) — return no-ops.
    return {
      emitWasherGroupOffer: () => {},
      emitWasherGroupOfferResolved: () => {},
      emitWasherGroupOfferExpired: () => {},
    };
  }
}

function _buildOfferPayload(offer, rideGroup) {
  return {
    offerId: String(offer._id),
    rideGroupId: String(rideGroup._id),
    orderCount: offer.orderCount,
    totalClothQuantity: offer.totalClothQuantity,
    totalDistanceMeters: offer.totalDistanceMeters,
    totalDurationSeconds: offer.totalDurationSeconds,
    pickupSequence: offer.pickupSequence.map(String),
    expiresAt: offer.expiresAt,
    pickupSlot: rideGroup.pickupSlot,
  };
}

/**
 * Reconcile any WasherGroupOffers that are still PENDING but past their
 * expiresAt — called by the cron on startup and periodically, to recover
 * timers lost across server restarts.
 */
async function reconcileExpiredWasherOffers() {
  const stale = await WasherGroupOffer.find({
    status: WASHER_GROUP_OFFER_STATUS.PENDING,
    expiresAt: { $lte: new Date() },
  }).lean();

  for (const offer of stale) {
    const alreadyScheduled = activeTimers.has(String(offer._id));
    if (!alreadyScheduled) {
      await expireWasherOffer(offer._id);
    }
  }

  if (stale.length > 0) {
    console.log(`[WasherAuction] Reconciled ${stale.length} stale washer offer(s).`);
  }
}

module.exports = {
  createWasherOffer,
  acceptWasherOffer,
  expireWasherOffer,
  reconcileExpiredWasherOffers,
};
