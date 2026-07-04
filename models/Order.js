const mongoose = require("mongoose");

const OrderItemSchema = new mongoose.Schema({
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Service",
    required: true
  },

  serviceName: String,

  categoryName: {
    type: String,
    required: true
  },

  subCategoryName: {
    type: String,
    required: true
  },

  quantity: {
    type: Number,
    required: true,
    min: 1
  },

  unitPrice: {
    type: Number,
    required: true
  },

  totalPrice: {
    type: Number,
    required: true
  }

});

const AddressSchema = new mongoose.Schema({
  coordinates: {
    type: [Number],
    default: []
  },

  address: String
});

const OrderSchema = new mongoose.Schema({

  orderNumber: {
    type: String,
    unique: true
  },

  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer",
    required: true
  },

  items: [OrderItemSchema],

  subtotal: {
    type: Number,
    default: 0
  },

  tax: {
    type: Number,
    default: 0
  },

  discount: {
    type: Number,
    default: 0
  },

  totalAmount: {
    type: Number,
    required: true
  },

  status: {
    type: String,
    enum: [
      "pending_sp",
      "sp_assigned",
      "sp_accepted",
      "rider_pickup_assigned",
      "picked_up",
      "at_sp",
      "cleaned",
      "rider_delivery_assigned",
      "delivered",
      "cancelled"
    ],
    default: "pending_sp"
  },

  statusHistory: [{
    status: String,
    note: {
      type: String,
      default: ""
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  }],

  pickupAddress: AddressSchema,
  deliveryAddress: AddressSchema,

  serviceProviderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "ServiceProvider"
  },

  riderPickupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Rider"
  },

  riderDeliveryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Rider"
  },

  pickupScheduledAt: Date,
  deliveryScheduledAt: Date,
  estimatedDelivery: Date,

  paymentMethod: {
    type: String,
    enum: ["cash", "upi", "card"]
  },

  paymentStatus: {
    type: String,
    enum: ["pending", "paid", "failed"],
    default: "pending"
  },

  cancellation: {
    cancelledAt: Date,
    cancelledBy: {
      type: String,
      enum: ["customer", "admin", "system"],
    },
    isFreeCancellation: Boolean,
    cancellationFee: {
      type: Number,
      default: 0,
    },
    refundAmount: {
      type: Number,
      default: 0,
    },
    refundMode: {
      type: String,
      enum: ["wallet_credit", "coupon", "none"],
      default: "none",
    },
    refundStatus: {
      type: String,
      enum: ["not_applicable", "processing", "completed"],
      default: "not_applicable",
    },
  }

},
  {
    timestamps: true
  });

OrderSchema.index({
  customerId: 1,
  status: 1
});

module.exports = mongoose.model(
  "Order",
  OrderSchema
);