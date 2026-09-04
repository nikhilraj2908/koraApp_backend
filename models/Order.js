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

  // Optional cloth reference photos, grouped by service type so the
  // washer/rider know exactly which items need washing vs. ironing.
  // Stored as relative paths (like every other upload in this app) —
  // /api/admin/orders responses turn these into absolute URLs for display.
  clothPhotos: {
    wash: { type: [String], default: [] },
    iron: { type: [String], default: [] },
  },

  // Dedicated GeoJSON field for spatial queries ($near / $geoNear during
  // clustering) — pickupAddress.coordinates above is a plain array with
  // no index and isn't queryable this way. Populated from the same
  // coordinates at order-creation time; kept in sync, never edited
  // independently.
  pickupLocation: {
    // NOTE: deliberately no `default` on either leaf field below.
    // Mongoose applies leaf-level defaults for a plain nested object
    // independently of whether the PARENT path (pickupLocation) was
    // provided at all — so a `default: "Point"` here previously caused
    // Mongoose to materialize `{ type: "Point" }` (with NO coordinates)
    // even when createOrder explicitly passed `pickupLocation: undefined`
    // for orders with an invalid/missing pickup address. A 2dsphere index
    // tolerates a genuinely MISSING pickupLocation field just fine (it's
    // simply excluded from the index), but throws a hard "Can't extract
    // geo keys" error on an INCOMPLETE Point — which is exactly what that
    // default silently produced on every order whose pickup address
    // lacked coordinates, breaking order creation entirely. Removing the
    // default means an omitted pickupLocation stays fully unset, which
    // the index handles correctly.
    type: { type: String, enum: ["Point"] },
    coordinates: { type: [Number] }, // [lng, lat]
  },

  // ── Pickup slot / dispatch pipeline (see constants/dispatchConstants.js) ──
  clothQuantity: {
    // Total piece count across all items — denormalized here so the
    // grouping job can read it without populating/summing `items` on
    // every pending order every time a slot starts.
    type: Number,
    default: 0,
  },

  bookingTime: {
    // Explicit field per spec, even though it's very close to
    // `createdAt` — keeps the slot-assignment logic's intent obvious
    // (this is specifically "when the customer booked", used to decide
    // which slot the order falls into) independent of Mongoose internals.
    type: Date,
    default: Date.now,
  },

  pickupDate: {
    // Calendar date (midnight, dispatch timezone) this order's pickup
    // slot falls on — lets the scheduler query "all of today's morning
    // orders" with a simple equality match.
    type: Date,
  },

  pickupSlot: {
    type: String,
    enum: ["MORNING", "EVENING"],
  },

  dispatchStatus: {
    // Parallel to `status` above — `status` drives the existing
    // customer-facing tracking UI/notifications and must not be touched
    // by the grouping/auction pipeline directly. This tracks this
    // order's position in THAT pipeline specifically. Once a rider
    // accepts the group containing this order, dispatchStatus becomes
    // "assigned" and status transitions to "rider_pickup_assigned" (the
    // existing tracking value), converging the two.
    type: String,
    enum: ["awaiting_slot", "grouping", "grouped", "offer_pending", "assigned", "cancelled"],
    default: "awaiting_slot",
  },

  rideGroupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "RideGroup",
    default: null,
  },

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

// Geospatial index — required for $near/$geoNear queries during clustering.
OrderSchema.index({ pickupLocation: "2dsphere" });

// Scheduler's core query: "all pending orders for today's morning slot".
OrderSchema.index({ pickupSlot: 1, pickupDate: 1, dispatchStatus: 1 });

module.exports = mongoose.model(
  "Order",
  OrderSchema
);