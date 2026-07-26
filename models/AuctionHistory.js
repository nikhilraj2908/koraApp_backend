const mongoose = require("mongoose");

/**
 * One document per RideOffer, accumulating every price-escalation step
 * and the final outcome. Kept separate from RideOffer itself (which only
 * needs the CURRENT price) so this can grow freely without bloating the
 * hot document that's read/written on every escalation tick, and so
 * admins can analyze pricing behavior (how often max price is hit, how
 * long acceptance typically takes, etc.) without scanning RideOffer.
 */
const AuctionHistorySchema = new mongoose.Schema(
  {
    rideOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RideOffer",
      required: true,
      unique: true,
    },

    rideGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RideGroup",
      required: true,
    },

    priceSteps: [{
      price: Number,
      at: { type: Date, default: Date.now },
    }],

    outcome: {
      type: String,
      enum: ["accepted", "expired_no_riders", "expired_max_price", "cancelled"],
    },

    acceptedByRiderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
    },
    finalPrice: Number,
    timeToAcceptSeconds: Number,
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuctionHistory", AuctionHistorySchema);