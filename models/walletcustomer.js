const mongoose = require("mongoose");

const WalletTransactionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["refund", "credit", "debit", "cashback"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    reason: {
      type: String,
      default: "",
    },

    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },

    orderNumber: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const WalletSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      unique: true,
    },

    balance: {
      type: Number,
      default: 0,
    },

    transactions: [WalletTransactionSchema],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Wallet", WalletSchema);