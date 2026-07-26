const mongoose = require("mongoose");

/**
 * A single Configuration document exists per environment (singleton
 * pattern via a fixed `key: "default"`). Admins edit this at runtime
 * through the config API (Phase 4) — no redeploy or code change needed
 * to adjust slot timings, pricing, group size, or rider search radius.
 */
const ConfigurationSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "default",
      unique: true,
    },

    timezone: { type: String, required: true },

    slots: {
      MORNING: {
        start: { type: String, required: true }, // "HH:mm"
        end: { type: String, required: true },
      },
      EVENING: {
        start: { type: String, required: true },
        end: { type: String, required: true },
      },
    },

    grouping: {
      maxGroupSize: { type: Number, required: true, min: 1 },
      clusterRadiusKm: { type: Number, required: true, min: 0.1 },
    },

    riderDiscovery: {
      radiusKm: { type: Number, required: true, min: 0.1 },
    },

    pricing: {
      startingOffer: { type: Number, required: true, min: 0 },
      maxOffer: { type: Number, required: true, min: 0 },
      increment: { type: Number, required: true, min: 0 },
      escalationIntervalSeconds: { type: Number, required: true, min: 1 },
      currency: { type: String, default: "INR" },
    },

    auction: {
      riderResponseWindowSeconds: { type: Number, required: true, min: 5 },
    },

    scheduler: {
      morningTriggerCron: { type: String, required: true },
      eveningTriggerCron: { type: String, required: true },
    },

    notificationRetry: {
      maxAttempts: { type: Number, required: true, min: 0 },
      backoffSeconds: { type: Number, required: true, min: 1 },
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Configuration", ConfigurationSchema);