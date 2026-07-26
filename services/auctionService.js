/**
 * services/auctionService.js
 *
 * The live auction lifecycle for one RideOffer: create it (with nearby
 * riders notified), escalate its price on a timer, resolve it the
 * instant a rider accepts (atomically — this is what makes "only one
 * rider can ever win" safe under concurrent accept attempts), or expire
 * it if nobody does.
 *
 * NOTE on escalation timers: this uses in-process setTimeout chains
 * (see scheduleEscalationTimer below). That's genuinely fine for a
 * single-instance deployment, but does NOT survive a server restart —
 * if the process restarts mid-auction, any RideOffers with a
 * nextEscalationAt in the past need to be picked back up. That
 * reconciliation sweep belongs in Phase 4's job scheduler (a cron tick
 * that re-arms timers for any "orphaned" pending offers on boot and
 * periodically), not duplicated here.
 */

const mongoose = require("mongoose");
const dayjs = require("dayjs");

const RideGroup = require("../models/RideGroup");
const RideOffer = require("../models/RideOffer");
const Assignment = require("../models/Assignment");
const AuctionHistory = require("../models/AuctionHistory");
const RideNotificationLog = require("../models/RideNotificationLog");
const Order = require("../models/Order");
const Rider = require("../models/Rider");

const { getConfig } = require("../repositories/configRepository");
const { findNearbyAvailableRiders } = require("../repositories/riderRepository");
const { notifyCustomer, sendPushNotification } = require("../utils/notification");
const { emitOrderUpdate } = require("../socket/trackingSocket");
const {
  RIDE_GROUP_STATUS,
  RIDE_OFFER_STATUS,
  ASSIGNMENT_STATUS,
} = require("../constants/dispatchConstants");

let rideOfferSocket = null;
/**
 * Lazily wired from server.js after socket.io is initialized, to avoid a
 * circular require (socket/rideOfferSocket.js needs acceptOffer from
 * THIS file for its accept handler, and this file needs the broadcast
 * functions from THAT file).
 */
function attachSocketBroadcaster(broadcaster) {
  rideOfferSocket = broadcaster;
}

// In-process escalation timers, keyed by rideOfferId string — see the
// module-level note above on why this doesn't survive a restart.
const activeTimers = new Map();

function clearEscalationTimer(rideOfferId) {
  const key = rideOfferId.toString();
  const handle = activeTimers.get(key);
  if (handle) {
    clearTimeout(handle);
    activeTimers.delete(key);
  }
}

function scheduleEscalationTimer(rideOfferId, delayMs) {
  clearEscalationTimer(rideOfferId);
  const handle = setTimeout(() => {
    escalatePrice(rideOfferId).catch((err) =>
      console.error(`[Auction] Escalation tick failed for offer ${rideOfferId}:`, err)
    );
  }, delayMs);
  activeTimers.set(rideOfferId.toString(), handle);
}

/**
 * Creates a RideOffer for an already-routed RideGroup, finds nearby
 * available riders, broadcasts to them, and arms the first escalation
 * timer. Returns null (does NOT throw) if there are no nearby riders —
 * that's an expected edge case (spec: "No riders nearby"), not an error;
 * the RideGroup is left in ROUTED status so a retry job can try again
 * later, e.g. with a wider radius.
 */
async function createOfferForGroup(rideGroupId) {
  const rideGroup = await RideGroup.findById(rideGroupId);
  if (!rideGroup) throw new Error(`RideGroup ${rideGroupId} not found`);

  if (rideGroup.status !== RIDE_GROUP_STATUS.ROUTED) {
    console.log(`[Auction] RideGroup ${rideGroupId} is not ROUTED (status=${rideGroup.status}) — skipping offer creation.`);
    return null;
  }

  const config = await getConfig();
  const orders = await Order.find({ _id: { $in: rideGroup.orderIds } }).lean();

  // Centroid of this group's pickup points, used as the search origin
  // for nearby riders.
  const validPoints = orders
    .map((o) => o.pickupLocation?.coordinates)
    .filter((c) => Array.isArray(c) && c.length === 2);

  if (validPoints.length === 0) {
    console.error(`[Auction] RideGroup ${rideGroupId} has no orders with valid pickupLocation — cannot search for nearby riders.`);
    return null;
  }

  const centroid = [
    validPoints.reduce((sum, [lng]) => sum + lng, 0) / validPoints.length,
    validPoints.reduce((sum, [, lat]) => sum + lat, 0) / validPoints.length,
  ];

  const nearbyRiders = await findNearbyAvailableRiders(centroid, config.riderDiscovery.radiusKm);

  if (nearbyRiders.length === 0) {
    console.log(`[Auction] No nearby available riders for RideGroup ${rideGroupId} — leaving it ROUTED for a retry.`);
    return null;
  }

  const now = new Date();
  const nextEscalationAt = dayjs(now).add(config.pricing.escalationIntervalSeconds, "second").toDate();
  const expiresAt = dayjs(now).add(config.auction.riderResponseWindowSeconds, "second").toDate();

  const rideOffer = await RideOffer.create({
    rideGroupId: rideGroup._id,
    pickupSequence: rideGroup.optimizedRoute.sequence,
    totalDistanceMeters: rideGroup.optimizedRoute.totalDistanceMeters,
    totalDurationSeconds: rideGroup.optimizedRoute.totalDurationSeconds,
    totalClothQuantity: rideGroup.totalClothQuantity,
    orderCount: rideGroup.orderIds.length,
    startingOffer: config.pricing.startingOffer,
    maxOffer: config.pricing.maxOffer,
    increment: config.pricing.increment,
    currentOffer: config.pricing.startingOffer,
    escalationIntervalSeconds: config.pricing.escalationIntervalSeconds,
    nextEscalationAt,
    notifiedRiderIds: nearbyRiders.map((r) => r._id),
    status: RIDE_OFFER_STATUS.PENDING,
    expiresAt,
  });

  rideGroup.status = RIDE_GROUP_STATUS.OFFERED;
  await rideGroup.save();

  await AuctionHistory.create({
    rideOfferId: rideOffer._id,
    rideGroupId: rideGroup._id,
    priceSteps: [{ price: config.pricing.startingOffer, at: now }],
  });

  await RideNotificationLog.insertMany(
    nearbyRiders.map((r) => ({
      rideOfferId: rideOffer._id,
      riderId: r._id,
      channel: "socket",
      event: "offer_created",
      priceAtSend: config.pricing.startingOffer,
    }))
  );

  if (rideOfferSocket) {
    rideOfferSocket.broadcastRideOffer(rideOffer, nearbyRiders.map((r) => r._id));
  }

  // Socket covers riders with the app open right now; a real push
  // covers the rest (backgrounded/killed app), same rationale as the
  // customer-facing notifyCustomer system. Only sent once, on creation
  // — not on every price escalation tick, to avoid spamming a rider who
  // already has the offer open in-app watching the price climb live.
  const distanceKm = (rideGroup.optimizedRoute.totalDistanceMeters / 1000).toFixed(1);
  await Promise.all(
    nearbyRiders
      .filter((r) => r.expoPushToken)
      .map((r) =>
        sendPushNotification(r.expoPushToken, {
          title: "New Pickup Offer 🧺",
          body: `${rideGroup.orderIds.length} pickups • ${rideGroup.totalClothQuantity} items • ${distanceKm} km • ₹${config.pricing.startingOffer}`,
          data: { rideOfferId: rideOffer._id.toString(), type: "ride_offer" },
        }).then(
          () =>
            RideNotificationLog.create({
              rideOfferId: rideOffer._id,
              riderId: r._id,
              channel: "push",
              event: "offer_created",
              priceAtSend: config.pricing.startingOffer,
            }),
          (err) =>
            RideNotificationLog.create({
              rideOfferId: rideOffer._id,
              riderId: r._id,
              channel: "push",
              event: "offer_created",
              priceAtSend: config.pricing.startingOffer,
              status: "failed",
              error: err.message,
            })
        )
      )
  );

  // Also expire this offer outright at expiresAt regardless of price —
  // covers the case where escalation reaches maxOffer well before the
  // response window closes, and nobody has accepted yet.
  scheduleEscalationTimer(rideOffer._id, config.pricing.escalationIntervalSeconds * 1000);

  console.log(`[Auction] Offer ${rideOffer._id} created for RideGroup ${rideGroupId} — ${nearbyRiders.length} rider(s) notified, starting at ₹${config.pricing.startingOffer}.`);

  return rideOffer;
}

/**
 * One escalation tick — bumps the price by one increment (capped at
 * maxOffer), or expires the offer if it's past its hard expiresAt.
 * Reschedules itself for the next tick unless the offer is resolved.
 */
async function escalatePrice(rideOfferId) {
  const rideOffer = await RideOffer.findById(rideOfferId);

  // Already accepted/expired/cancelled by the time this tick fired —
  // nothing to do (this is the normal, expected case whenever a rider
  // accepts before the next scheduled escalation).
  if (!rideOffer || rideOffer.status !== RIDE_OFFER_STATUS.PENDING) {
    clearEscalationTimer(rideOfferId);
    return;
  }

  const now = new Date();

  if (now >= rideOffer.expiresAt || rideOffer.currentOffer >= rideOffer.maxOffer) {
    return expireOffer(rideOfferId, now >= rideOffer.expiresAt ? "expired_no_riders" : "expired_max_price");
  }

  const newPrice = Math.min(rideOffer.currentOffer + rideOffer.increment, rideOffer.maxOffer);
  const nextEscalationAt = dayjs(now).add(rideOffer.escalationIntervalSeconds, "second").toDate();

  rideOffer.currentOffer = newPrice;
  rideOffer.nextEscalationAt = nextEscalationAt;
  await rideOffer.save();

  await AuctionHistory.updateOne(
    { rideOfferId: rideOffer._id },
    { $push: { priceSteps: { price: newPrice, at: now } } }
  );

  if (rideOfferSocket) {
    rideOfferSocket.broadcastPriceUpdate(rideOffer);
  }

  console.log(`[Auction] Offer ${rideOfferId} escalated to ₹${newPrice}.`);

  // Still room to escalate further before expiresAt — arm the next tick.
  // If we just hit maxOffer, still schedule one more tick at the
  // interval so we naturally fall into the expiresAt check above once
  // the response window closes, rather than waiting silently forever.
  scheduleEscalationTimer(rideOfferId, rideOffer.escalationIntervalSeconds * 1000);
}

/**
 * Atomically resolves a RideOffer to a specific rider — this is the
 * "only one rider can ever win" guarantee. The filter's `status: PENDING`
 * is what makes it safe: if two riders call this within milliseconds of
 * each other, MongoDB only lets ONE findOneAndUpdate actually match and
 * flip the document; the other's filter no longer matches (status has
 * already changed), so it gets back `null` and knows it lost the race —
 * no separate distributed lock needed for this specific step.
 */
async function acceptOffer(rideOfferId, riderId) {
  const now = new Date();

  // Aggregation-pipeline update so `finalPrice` can reference the
  // document's OWN current `currentOffer` value atomically, in the same
  // operation as the status flip — avoids a separate read-then-write
  // that could race with an escalation tick landing in between.
  const wonOffer = await RideOffer.findOneAndUpdate(
    { _id: rideOfferId, status: RIDE_OFFER_STATUS.PENDING },
    [
      {
        $set: {
          status: RIDE_OFFER_STATUS.ACCEPTED,
          acceptedByRiderId: riderId,
          acceptedAt: now,
          finalPrice: "$currentOffer",
        },
      },
    ],
    { new: true }
  );

  if (!wonOffer) {
    return { success: false, reason: "offer_no_longer_available" };
  }

  clearEscalationTimer(rideOfferId);

  // From here on, the offer is locked to this rider no matter what —
  // if anything below fails, we log loudly for manual reconciliation
  // rather than silently losing an accepted ride. Wrapped in a
  // transaction so the Assignment/RideGroup/Order/Rider writes either
  // all land together or all roll back cleanly.
  const session = await mongoose.startSession();
  let assignment;

  try {
    await session.withTransaction(async () => {
      assignment = await Assignment.create(
        [
          {
            rideGroupId: wonOffer.rideGroupId,
            rideOfferId: wonOffer._id,
            riderId,
            orderIds: wonOffer.pickupSequence,
            agreedPrice: wonOffer.finalPrice,
            status: ASSIGNMENT_STATUS.ACTIVE,
          },
        ],
        { session }
      ).then((docs) => docs[0]);

      await RideGroup.updateOne(
        { _id: wonOffer.rideGroupId },
        { $set: { status: RIDE_GROUP_STATUS.ASSIGNED, assignedRiderId: riderId } },
        { session }
      );

      await Order.updateMany(
        { _id: { $in: wonOffer.pickupSequence } },
        {
          // riderPickupId is what the existing tracking UI populates to
          // show the rider's name/phone (see socket/trackingSocket.js's
          // buildOrderPayload) — without setting it here, an order
          // assigned via this new auction path would show the right
          // status label but no rider details, unlike orders assigned
          // through the older manual flow.
          $set: { dispatchStatus: "assigned", status: "rider_pickup_assigned", riderPickupId: riderId },
          $push: { statusHistory: { status: "rider_pickup_assigned", note: "Assigned via pickup auction" } },
        },
        { session }
      );

      await Rider.updateOne(
        { _id: riderId },
        { $set: { isAvailable: false } },
        { session }
      );

      const auctionCreatedAt = await AuctionHistory.findOne({ rideOfferId: wonOffer._id }, null, { session }).then(
        (h) => h?.createdAt
      );

      await AuctionHistory.updateOne(
        { rideOfferId: wonOffer._id },
        {
          $set: {
            outcome: "accepted",
            acceptedByRiderId: riderId,
            finalPrice: wonOffer.finalPrice,
            timeToAcceptSeconds: auctionCreatedAt
              ? Math.round((now.getTime() - auctionCreatedAt.getTime()) / 1000)
              : undefined,
          },
        },
        { session }
      );
    });
  } catch (err) {
    console.error(
      `[Auction] CRITICAL: offer ${rideOfferId} was locked to rider ${riderId} but finalizing the assignment failed — needs manual reconciliation:`,
      err
    );
    throw err;
  } finally {
    await session.endSession();
  }

  // Notifications fire AFTER the transaction commits, never inside it —
  // if the transaction were retried internally by the driver, an
  // inside-transaction side effect like a push notification could fire
  // more than once.
  const orders = await Order.find({ _id: { $in: wonOffer.pickupSequence } })
    .populate('riderPickupId', 'name phone')
    .populate('riderDeliveryId', 'name phone');
  for (const order of orders) {
    notifyCustomer(order.customerId, {
      title: "Rider Assigned! 🛵",
      body: `A rider has been assigned to pick up your order ${order.orderNumber}.`,
      type: "order_accepted",
      orderId: order._id,
      orderNumber: order.orderNumber,
    });
    // Same live-tracking-screen update mechanism routes/riderRoutes.js
    // already uses for other status changes — keeps this new auction
    // path consistent with the existing rider-driven update flow.
    emitOrderUpdate(order);
  }

  if (rideOfferSocket) {
    rideOfferSocket.broadcastOfferResolved(wonOffer, riderId);
  }

  console.log(`[Auction] Offer ${rideOfferId} WON by rider ${riderId} at ₹${wonOffer.finalPrice}.`);

  return { success: true, assignment, rideOffer: wonOffer };
}

/**
 * Atomically expires a pending offer — same PENDING-guard pattern as
 * acceptOffer, so a rider's accept racing against the exact same tick
 * that would expire it can't both succeed.
 */
async function expireOffer(rideOfferId, reason = "expired_no_riders") {
  const expired = await RideOffer.findOneAndUpdate(
    { _id: rideOfferId, status: RIDE_OFFER_STATUS.PENDING },
    { $set: { status: RIDE_OFFER_STATUS.EXPIRED } },
    { new: true }
  );

  if (!expired) return null; // already resolved by an accept — nothing to do

  clearEscalationTimer(rideOfferId);

  // Leave the RideGroup ROUTED (not EXPIRED) so a retry job (Phase 4) can
  // create a fresh RideOffer for the same group — e.g. with a widened
  // rider-search radius — rather than losing the group's route
  // optimization work and re-clustering from scratch.
  await RideGroup.updateOne(
    { _id: expired.rideGroupId },
    { $set: { status: RIDE_GROUP_STATUS.ROUTED } }
  );

  await AuctionHistory.updateOne(
    { rideOfferId: expired._id },
    { $set: { outcome: reason } }
  );

  if (rideOfferSocket) {
    rideOfferSocket.broadcastOfferExpired(expired);
  }

  console.log(`[Auction] Offer ${rideOfferId} expired (${reason}).`);

  return expired;
}

module.exports = {
  attachSocketBroadcaster,
  createOfferForGroup,
  escalatePrice,
  acceptOffer,
  expireOffer,
};