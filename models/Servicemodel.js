const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
    },
    pricePerPair: {
      type: Number,
      required: true,
      min: 0,
    },
    estimatedHours: {
      type: Number,
      default: 24,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true, 
  }
);

module.exports = mongoose.model('Service', serviceSchema);