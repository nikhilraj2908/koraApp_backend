const Order = require("../models/Order");


const STATUS_LABEL = {
  pending_sp:               "Order Placed",
  sp_assigned:              "SP Assigned",
  sp_accepted:              "SP Accepted",
  rider_pickup_assigned:    "Rider Assigned for Pickup",
  picked_up:                "Order Picked Up",
  at_sp:                    "At Service Provider",
  cleaned:                  "Cleaned",
  rider_delivery_assigned:  "Out for Delivery",
  delivered:                "Delivered",
  cancelled:                "Cancelled",
};


const STATUS_ICON = {
  pending_sp:               "package-variant-closed",
  sp_assigned:              "account-check-outline",
  sp_accepted:              "handshake-outline",
  rider_pickup_assigned:    "motorbike",
  picked_up:                "package-variant",
  at_sp:                    "store-outline",
  cleaned:                  "tshirt-crew",
  rider_delivery_assigned:  "truck-delivery",
  delivered:                "check-circle-outline",
  cancelled:                "close-circle-outline",
};

/** Full ordered list of statuses (excluding cancelled — handled separately). */
const STATUS_SEQUENCE = [
  "pending_sp",
  "sp_assigned",
  "sp_accepted",
  "rider_pickup_assigned",
  "picked_up",
  "at_sp",
  "cleaned",
  "rider_delivery_assigned",
  "delivered",
];

/**
 * Build a user-friendly tracking timeline from an order document.
 *
 * Returns only the steps up to (currentStep + 1) so the app
 * doesn't expose future steps that haven't happened yet.
 */
const buildTrackingSteps = (order) => {
  const history = order.statusHistory || [];

  const allSteps =
    order.status === "cancelled"
      ? [...STATUS_SEQUENCE, "cancelled"]
      : STATUS_SEQUENCE;

  const steps = allSteps.map((s) => {
    const historyEntry = history.find((h) => h.status === s);
    const completed    = !!historyEntry;

    /* Estimate delivery time for rider_delivery_assigned if not yet reached */
    let time = "";
    if (completed && historyEntry?.updatedAt) {
      time = new Date(historyEntry.updatedAt).toLocaleString("en-IN", {
        hour:   "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } else if (
      s === "rider_delivery_assigned" &&
      !completed &&
      !["delivered", "cancelled"].includes(order.status)
    ) {
      const base =
        history.find((h) => h.status === "cleaned")?.updatedAt ||
        order.createdAt;
      const est = new Date(new Date(base).getTime() + 2 * 60 * 60 * 1000);
      time = `Est. ${est.toLocaleTimeString("en-IN", {
        hour:   "2-digit",
        minute: "2-digit",
        hour12: true,
      })}`;
    }

    return {
      status:    s,
      label:     STATUS_LABEL[s],
      icon:      STATUS_ICON[s],
      time,
      completed,
      isEst:     s === "rider_delivery_assigned" && !completed,
    };
  });

  /* Show completed steps + the very next pending step only */
  const currentIdx = allSteps.indexOf(order.status);
  return order.status === "cancelled"
    ? steps.filter((s) => s.status === "cancelled" || s.completed)
    : steps.slice(0, currentIdx + 2);
};

/**
 * Map an order document to the shape expected by the React Native screen.
 */
const formatOrderForApp = (order) => ({
  id:          order.orderNumber,
  service:     order.items[0]?.serviceName || "Laundry",
  items:       order.items.reduce((sum, i) => sum + i.quantity, 0),
  date:        new Date(order.createdAt).toLocaleDateString("en-IN", {
    day:   "numeric",
    month: "short",
    year:  "numeric",
  }),
  price:         order.totalAmount,
  status:        order.status,
  statusLabel:   STATUS_LABEL[order.status] || order.status,
  pickupAddress: order.pickupAddress,
  deliveryAddress: order.deliveryAddress,
  rider: order.deliveryRider || order.pickupRider || null,
  estimatedDelivery: order.estimatedDeliveryTime || null,
  trackingSteps: buildTrackingSteps(order),
});


/* ════════════════════════════════════════════════
   CONTROLLERS
════════════════════════════════════════════════ */

/**
 * GET /api/orders/track/:orderNumber
 *
 * Returns full tracking detail for one order.
 * Only the order's owner can access it.
 */
exports.trackOrder = async (req, res) => {
  try {
    const order = await Order.findOne({
      orderNumber: req.params.orderNumber,
    }).populate("pickupRider deliveryRider", "name phone");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    /* Ownership check */
    if (order.customerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    res.json({
      success: true,
      data: formatOrderForApp(order),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/orders/active
 *
 * Returns all in-progress orders for the logged-in customer.
 */
exports.getActiveOrders = async (req, res) => {
  try {
    const ACTIVE_STATUSES = [
      "pending_sp",
      "sp_assigned",
      "sp_accepted",
      "rider_pickup_assigned",
      "picked_up",
      "at_sp",
      "cleaned",
      "rider_delivery_assigned",
    ];

    const orders = await Order.find({
      customerId: req.user.id,
      status: { $in: ACTIVE_STATUSES },
    })
      .sort({ createdAt: -1 })
      .populate("pickupRider deliveryRider", "name phone");

    if (!orders.length) {
      return res.json({ success: true, data: [] });
    }

    res.json({
      success: true,
      data: orders.map(formatOrderForApp),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/orders/history
 *
 * Returns delivered & cancelled orders for the logged-in customer.
 */
exports.getOrderHistory = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const skip  = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({
        customerId: req.user.id,
        status: { $in: ["delivered", "cancelled"] },
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments({
        customerId: req.user.id,
        status: { $in: ["delivered", "cancelled"] },
      }),
    ]);

    res.json({
      success: true,
      data: orders.map((o) => ({
        id:          o.orderNumber,
        service:     o.items[0]?.serviceName || "Laundry",
        items:       o.items.reduce((sum, i) => sum + i.quantity, 0),
        date:        new Date(o.createdAt).toLocaleDateString("en-IN", {
          day: "numeric", month: "short", year: "numeric",
        }),
        price:       o.totalAmount,
        status:      o.status === "delivered" ? "Delivered" : "Cancelled",
        iconName:    "package-variant",
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/orders/:id/status          (admin / rider only)
 *
 * Updates order status and appends an entry to statusHistory.
 */
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, note = "" } = req.body;

    if (!STATUS_LABEL[status]) {
      return res.status(400).json({
        success: false,
        message: `Invalid status: ${status}`,
      });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    order.status = status;
    order.statusHistory.push({ status, note });

    /* Auto-set estimatedDeliveryTime when laundry is cleaned */
    if (status === "cleaned" && !order.estimatedDeliveryTime) {
      order.estimatedDeliveryTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
    }

    await order.save();

    res.json({
      success: true,
      message: "Status updated",
      data: {
        orderNumber: order.orderNumber,
        status:      order.status,
        statusLabel: STATUS_LABEL[order.status],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};