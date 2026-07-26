const mongoose = require("mongoose");
const { RIDE_GROUP_STATUS } = require("../constants/dispatchConstants");

/**
 * A RideGroup is a cluster of 2-3 geographically-nearby pending orders,
 * created by the grouping job when a pickup slot starts. Once route
 * optimization completes, exactly one RideOffer is created from it.
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

    // Populated once route optimization (Phase 3) runs — the same
    // orderIds, but sequenced for the shortest pickup route, plus the
    // route metrics used to build the ride offer.
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