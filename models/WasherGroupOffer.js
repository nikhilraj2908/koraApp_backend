const mongoose = require("mongoose");
const { WASHER_GROUP_OFFER_STATUS } = require("../constants/dispatchConstants");

/**
 * A WasherGroupOffer is created from exactly one RideGroup once its route is
 * optimized. It is broadcast to all nearby available washers simultaneously.
 * The first washer to call acceptWasherOffer() wins the group atomically
 * (enforced by the `status: "pending"` guard in findOneAndUpdate). The winner
 * is assigned to the RideGroup; all other notified washers receive a
 * `washer_group_offer_resolved` socket event and stop ringing.
 *
 * Unlike RideOffer (which has price escalation), WasherGroupOffer is a flat
 * first-come-first-served broadcast — no price changes during the window.
 */
const WasherGroupOfferSchema = new mongoose.Schema(
  {
    rideGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RideGroup",
      required: true,
      unique: true, // exactly one live offer per group at a time
    },

    // Denormalized from RideGroup at creation time so this document is
    // self-sufficient for washer-facing display without a join.
    pickupSequence: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    }],
    totalDistanceMeters: { type: Number, default: 0 },
    totalDurationSeconds: { type: Number, default: 0 },
    totalClothQuantity: { type: Number, default: 0 },
    orderCount: { type: Number, required: true },

    // Washers currently eligible to see/accept this offer (nearby +
    // verified at broadcast time). Used to target the socket broadcast and
    // to know who to send the resolved event to when it's accepted/expired.
    notifiedWasherIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Washer",
    }],

    status: {
      type: String,
      enum: Object.values(WASHER_GROUP_OFFER_STATUS),
      default: WASHER_GROUP_OFFER_STATUS.PENDING,
    },

    acceptedByWasherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Washer",
      default: null,
    },
    acceptedAt: { type: Date },

    // Hard expiry — offer dies at this time regardless of status.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

WasherGroupOfferSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model("WasherGroupOffer", WasherGroupOfferSchema);
