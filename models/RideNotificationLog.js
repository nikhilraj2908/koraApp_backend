const mongoose = require("mongoose");
const { NOTIFICATION_LOG_STATUS } = require("../constants/dispatchConstants");

/**
 * Tracks every attempt to notify a rider about a ride offer (initial
 * broadcast, each price-escalation update, and retries on failure).
 * Distinct from models/Notification.js, which is the customer-facing
 * order-status notification history — this is purely for the dispatch
 * system's rider-side delivery tracking and retry bookkeeping.
 */
const RideNotificationLogSchema = new mongoose.Schema(
  {
    rideOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RideOffer",
      required: true,
      index: true,
    },

    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      required: true,
    },

    channel: {
      type: String,
      enum: ["socket", "push"],
      required: true,
    },

    // e.g. "offer_created", "price_escalated", "offer_expired"
    event: {
      type: String,
      required: true,
    },

    priceAtSend: Number,

    status: {
      type: String,
      enum: Object.values(NOTIFICATION_LOG_STATUS),
      default: NOTIFICATION_LOG_STATUS.SENT,
    },

    attempt: {
      type: Number,
      default: 1,
    },

    error: String,
  },
  { timestamps: true }
);

RideNotificationLogSchema.index({ rideOfferId: 1, riderId: 1, event: 1 });

module.exports = mongoose.model("RideNotificationLog", RideNotificationLogSchema);