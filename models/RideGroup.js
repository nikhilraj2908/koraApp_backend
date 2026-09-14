const mongoose = require("mongoose");
const { RIDE_GROUP_STATUS } = require("../constants/dispatchConstants");

/**
 * A RideGroup is a cluster of 1-3 geographically-nearby pending orders,
 * created by the grouping job when a pickup slot starts. The pipeline is:
 *   1. groupingService clusters orders → RideGroup (FORMING → ROUTED)
 *   2. washerAuctionService broadcasts a WasherGroupOffer (WASHER_OFFER_PENDING)
 *   3. A washer accepts → RideGroup gets assignedWasherId (WASHER_ASSIGNED)
 *   4. auctionService broadcasts a RideOffer to nearby riders (OFFERED)
 *   5. A rider accepts → RideGroup gets assignedRiderId (ASSIGNED)
 */
const RideGroupSchema = new mongoose.Schema(
  {
    pickupSlot: {
      type: String,
      enum: ["MORNING", "EVENING"],
      required: true,
    },

    pickupDate: {
      // Calendar date (midnight, server timezone) this group's slot belongs
      // to — lets us query "all of today's morning groups" cleanly.
      type: Date,
      required: true,
    },

    // Orders in this group, in their ORIGINAL (unoptimized) order.
    orderIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    }],

    // Populated once route optimization runs — the same orderIds, but
    // sequenced for the shortest pickup route, plus the route metrics
    // used to build the washer offer and later the ride offer.
    optimizedRoute: {
      sequence: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      }],
      totalDistanceMeters: Number,
      totalDurationSeconds: Number,
      // Per-leg breakdown, same order as `sequence` (leg i = travel from
      // sequence[i] to sequence[i+1]); used for rider-facing route display.
      legs: [{
        fromOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
        toOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
        distanceMeters: Number,
        durationSeconds: Number,
      }],
    },

    totalClothQuantity: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: Object.values(RIDE_GROUP_STATUS),
      default: RIDE_GROUP_STATUS.FORMING,
    },

    // ── Washer assignment ──
    // Set once a washer accepts the WasherGroupOffer for this group.
    assignedWasherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Washer",
      default: null,
    },

    // Reference to the WasherGroupOffer document for this group.
    washerGroupOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WasherGroupOffer",
      default: null,
    },

    // ── Rider assignment ──
    // Set once an Assignment is made — denormalized here too for fast
    // "is this group taken?" checks without a join.
    assignedRiderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      default: null,
    },
  },
  { timestamps: true }
);

RideGroupSchema.index({ pickupSlot: 1, pickupDate: 1, status: 1 });

module.exports = mongoose.model("RideGroup", RideGroupSchema);