const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    // This is the Account _id (matches the rest of this codebase's
    // convention — see Order.customerId, Customer.accountId, etc.), not
    // the Customer document's own _id.
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
    },

    body: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      enum: [
        "order_placed",
        "order_accepted",
        "order_picked_up",
        "order_at_sp",
        "order_cleaned",
        "order_out_for_delivery",
        "order_delivered",
        "order_cancelled",
        "admin_broadcast",
        "general",
      ],
      default: "general",
    },

    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },

    orderNumber: {
      type: String,
    },

    read: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Notification", NotificationSchema);