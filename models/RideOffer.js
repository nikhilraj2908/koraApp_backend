const mongoose = require("mongoose");
const { RIDE_OFFER_STATUS } = require("../constants/dispatchConstants");

/**
 * A RideOffer is created from exactly one RideGroup once its route is
 * optimized. It carries the live auction state (current price, which
 * riders have been notified) until a rider accepts or it expires.
 */
const RideOfferSchema = new mongoose.Schema(
  {
    rideGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RideGroup",
      required: true,
      unique: true, // exactly one live offer per group at a time
    },

    // Denormalized from RideGroup at creation time so this document is
    // self-sufficient for rider-facing display without a join.
    pickupSequence: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    }],
    totalDistanceMeters: Number,
    totalDurationSeconds: Number,
    totalClothQuantity: Number,
    orderCount: Number,

    // ── Dynamic pricing state ──
    startingOffer: { type: Number, required: true },
    maxOffer: { type: Number, required: true },
    increment: { type: Number, required: true },
    currentOffer: { type: Number, required: true },
    escalationIntervalSeconds: { type: Number, required: true },
    nextEscalationAt: { type: Date, required: true },

    // Riders currently eligible to see/accept this offer (nearby +
    // online at broadcast time). Used to target the socket broadcast and
    // to know who to clear the offer from when it's accepted/expired.
    notifiedRiderIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
    }],

    status: {
      type: String,
      enum: Object.values(RIDE_OFFER_STATUS),
      default: RIDE_OFFER_STATUS.PENDING,
    },

    acceptedByRiderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      default: null,
    },
    acceptedAt: Date,
    finalPrice: Number,

    expiresAt: Date, // hard stop even if maxOffer hasn't been reached yet
  },
  { timestamps: true }
);

RideOfferSchema.index({ status: 1, nextEscalationAt: 1 });

module.exports = mongoose.model("RideOffer", RideOfferSchema);