/**
 * socket/rideOfferSocket.js
 *
 * Broadcasts ride-offer events to nearby riders, and handles a rider's
 * real-time "accept" action over the socket connection (lower latency
 * than a REST round-trip during a live 60-second auction window — a
 * REST endpoint for the same action also exists in
 * controllers/rideOfferController.js for clients that prefer it / as a
 * reliable fallback).
 *
 * Deliberately kept in its own file rather than added to
 * socket/trackingSocket.js directly — that file is working, existing
 * code for the customer/washer/order tracking flows, and this dispatch
 * system is new, separate functionality layered on top of the same io
 * instance via getIO().
 */

const { getIO } = require("./trackingSocket");

function emitToRiders(riderIds, event, payload) {
  const io = getIO();
  riderIds.forEach((riderId) => {
    io.to(`rider_${riderId.toString()}`).emit(event, payload);
  });
}

/**
 * Shapes a RideOffer document into what a rider's app actually needs to
 * render an offer card — matches the spec's example fields (pickup
 * route, total clothes, distance, time, current price, response window).
 */
function buildOfferPayload(rideOffer) {
  return {
    rideOfferId: rideOffer._id,
    rideGroupId: rideOffer.rideGroupId,
    orderCount: rideOffer.orderCount,
    totalClothQuantity: rideOffer.totalClothQuantity,
    pickupSequence: rideOffer.pickupSequence,
    totalDistanceKm: +(rideOffer.totalDistanceMeters / 1000).toFixed(1),
    totalDurationMinutes: Math.round(rideOffer.totalDurationSeconds / 60),
    currentOffer: rideOffer.currentOffer,
    maxOffer: rideOffer.maxOffer,
    expiresAt: rideOffer.expiresAt,
    status: rideOffer.status,
  };
}

function broadcastRideOffer(rideOffer, riderIds) {
  emitToRiders(riderIds, "ride_offer_created", buildOfferPayload(rideOffer));
}

function broadcastPriceUpdate(rideOffer) {
  emitToRiders(rideOffer.notifiedRiderIds, "ride_offer_price_updated", {
    rideOfferId: rideOffer._id,
    currentOffer: rideOffer.currentOffer,
  });
}

/**
 * Sent to every rider who was originally notified — the winner's client
 * compares `winningRiderId` against its own id to show "You got it!" vs
 * clearing the card because someone else did.
 */
function broadcastOfferResolved(rideOffer, winningRiderId) {
  emitToRiders(rideOffer.notifiedRiderIds, "ride_offer_resolved", {
    rideOfferId: rideOffer._id,
    winningRiderId,
  });
}

function broadcastOfferExpired(rideOffer) {
  emitToRiders(rideOffer.notifiedRiderIds, "ride_offer_expired", {
    rideOfferId: rideOffer._id,
  });
}

/**
 * Wires the `accept_ride_offer` socket event to the same acceptOffer
 * service every REST call goes through — call this once from server.js
 * after both socket.io and this module are initialized.
 *
 * SECURITY: riderId comes from socket.riderId (set by the JWT-verifying
 * auth middleware in trackingSocket.js's initSocket), never from the
 * client-supplied event payload. Accepting a ride is a real financial
 * commitment on the platform's behalf — trusting a client-claimed id
 * here would let anyone accept rides for any rider. A connection with no
 * verified token (socket.riderId is null) is rejected outright rather
 * than silently falling back to trusting the payload.
 */
function registerRideOfferSocketHandlers() {
  const io = getIO();
  const { acceptOffer } = require("../services/auctionService"); // lazy require avoids circular load at module-init time

  io.on("connection", (socket) => {
    socket.on("accept_ride_offer", async ({ rideOfferId }, callback) => {
      try {
        if (!socket.riderId) {
          if (typeof callback === "function") {
            callback({ success: false, reason: "unauthenticated" });
          }
          return;
        }

        const result = await acceptOffer(rideOfferId, socket.riderId);
        if (typeof callback === "function") callback(result);
      } catch (err) {
        console.error("[Socket] accept_ride_offer error:", err);
        if (typeof callback === "function") {
          callback({ success: false, reason: "server_error" });
        }
      }
    });
  });
}

module.exports = {
  broadcastRideOffer,
  broadcastPriceUpdate,
  broadcastOfferResolved,
  broadcastOfferExpired,
  registerRideOfferSocketHandlers,
};