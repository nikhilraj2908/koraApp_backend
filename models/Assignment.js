const mongoose = require("mongoose");
const { ASSIGNMENT_STATUS } = require("../constants/dispatchConstants");

/**
 * Created atomically the instant a rider accepts a RideOffer (see
 * services/assignmentService.js in Phase 3). One Assignment per
 * RideGroup — the unique index on rideGroupId is what makes "only one
 * rider can ever win a given group" enforceable at the database level,
 * not just in application logic.
 */
const AssignmentSchema = new mongoose.Schema(
  {
    rideGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RideGroup",
      required: true,
      unique: true,
    },

    rideOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RideOffer",
      required: true,
    },

    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      required: true,
    },

    orderIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    }],

    agreedPrice: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(ASSIGNMENT_STATUS),
      default: ASSIGNMENT_STATUS.ACTIVE,
    },

    completedAt: Date,
    cancelledAt: Date,
    cancellationReason: String,
  },
  { timestamps: true }
);

AssignmentSchema.index({ riderId: 1, status: 1 });

module.exports = mongoose.model("Assignment", AssignmentSchema);