const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },

    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },

    overallRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    categoryRatings: {
      pickup: { type: Number, min: 1, max: 5, default: null },
      quality: { type: Number, min: 1, max: 5, default: null },
      delivery: { type: Number, min: 1, max: 5, default: null },
      packaging: { type: Number, min: 1, max: 5, default: null },
    },

    tags: {
      type: [String],
      default: [],
    },

    review: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },

    isVisible: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Review", reviewSchema);