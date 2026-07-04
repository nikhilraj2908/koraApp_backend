const Order = require("../models/Order");
const Service = require("../models/Servicemodel");
const Customer = require("../models/Customer");
const Wallet = require("../models/walletcustomer");
const { emitNewOrderToWashers } = require('../socket/trackingSocket');

// ── Cancellation & Refund Policy constants (see Terms §8.1–8.5) ──────────────
const FREE_CANCELLATION_WINDOW_MS = 2 * 60 * 60 * 1000; // §8.1 — 2 hours
const LATE_CANCELLATION_FEE = 50; // §8.2 — ₹50

// Once an order reaches any of these statuses, pickup has already started,
// so this is no longer a simple, policy-driven self-cancel (§8.1 only applies
// "if pickup has not started"); route the customer to support instead.
const PICKUP_STARTED_STATUSES = [
  "picked_up",
  "at_sp",
  "cleaned",
  "rider_delivery_assigned",
  "delivered",
];

exports.createOrder = async (req, res) => {

  try {

    const customerId = req.user.id;

    const {
      items,
      pickupAddress,
      deliveryAddress,
      paymentMethod,
      pickupDay,   // ← add
      timeSlot
    } = req.body;


    if (!items || items.length === 0) {

      return res.status(400).json({
        success: false,
        message: "Cart empty"
      })

    }

    let finalItems = [];
    let subtotal = 0;


    for (const item of items) {

      const service = await Service.findById(
        item.serviceId
      );

      if (!service) {

        return res.status(400).json({
          success: false,
          message: `Invalid service`
        })

      }

      const unitPrice =
        service.pricePerKg;

      const totalPrice =
        unitPrice * item.quantity;

      subtotal += totalPrice;

      finalItems.push({

        serviceId: service._id,
        serviceName: service.name,

        categoryName:
          item.categoryName,

        subCategoryName:
          item.subCategoryName,

        quantity: item.quantity,

        unitPrice,
        totalPrice

      })

    }


    const tax = +(subtotal * 0.05).toFixed(2);

    const discount = 0;

    const totalAmount =
      subtotal +
      tax -
      discount;


    const orderNumber =
      `KR${Date.now()}`;

    let pickupScheduledAt = null;
    if (pickupDay && timeSlot) {
      const match = timeSlot.match(/(\d+):(\d+) (AM|PM)/);
      if (match) {
        let hour = parseInt(match[1]);
        const period = match[3];
        if (period === "PM" && hour !== 12) hour += 12;
        if (period === "AM" && hour === 12) hour = 0;
        pickupScheduledAt = new Date(
          `${pickupDay}T${String(hour).padStart(2, "0")}:00:00`
        );
      }
    }

    const order = await Order.create({
      customerId,
      orderNumber,
      items: finalItems,
      subtotal,
      tax,
      discount,
      totalAmount,
      pickupAddress,
      deliveryAddress,
      paymentMethod,
      pickupScheduledAt,   // ← yeh add karo
      status: "pending_sp",
      statusHistory: [{ status: "pending_sp" }]
    });


    emitNewOrderToWashers(order);
    res.status(201).json({

      success: true,
      message: "Order created",
      data: order

    })


  }
  catch (error) {

    console.log(error);

    res.status(500).json({

      success: false,
      message: error.message

    })

  }

}

// Recent orders

exports.getRecentOrders =
  async (req, res) => {

    try {

      const customerId =
        req.user.id;

      const orders =
        await Order.find({

          customerId

        })

          .sort({
            createdAt: -1
          })

          .limit(10);

      res.json({

        success: true,
        data: orders

      });

    }
    catch (error) {

      res.status(500).json({

        success: false,
        message: error.message

      });

    }

  };




// Order details

exports.getOrderDetails =
  async (req, res) => {

    try {

      const order = await Order.findOne({ orderNumber: req.params.id }); // ← yeh badla

      if (!order) {

        return res.status(404)
          .json({

            success: false,
            message:
              "Order not found"

          });

      }
      res.json({

        success: true,
        data: order

      });

    }
    catch (error) {

      res.status(500)
        .json({

          success: false,
          message: error.message

        });

    }

  };


// Update status

exports.updateStatus =
  async (req, res) => {

    try {

      const { status } =
        req.body;

      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {

        return res.status(404)
          .json({

            success: false,
            message: "Order not found"

          });

      }

      order.status = status;

      order.statusHistory.push({

        status

      });

      await order.save();

      res.json({

        success: true,
        message:
          "Status updated"

      });

    }
    catch (error) {

      res.status(500)
        .json({

          success: false,
          message: error.message

        });

    }

  };

// ── Cancel order (dedicated, policy-enforced endpoint — Terms §8.1–8.5) ─────
// Replaces the old approach of hitting the generic PUT /:id/status route with
// { status: "cancelled" }, which had no fee/refund/eligibility logic at all.
exports.cancelOrder = async (req, res) => {
  try {
    const order = await Order.findOne({ orderNumber: req.params.id });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // NOTE: Order.customerId stores the JWT's `id`, which is the Account
    // document's _id (see authController's token payload and createOrder
    // above) — NOT the Customer document's own _id. So ownership is checked
    // directly against req.user.id here, not against a Customer lookup.
    if (order.customerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to cancel this order",
      });
    }

    if (order.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "This order has already been cancelled",
      });
    }

    if (order.status === "delivered") {
      return res.status(400).json({
        success: false,
        message: "Delivered orders cannot be cancelled",
      });
    }

    // §8.1 only grants free cancellation "if pickup has not started" — once
    // it has, this isn't a clean self-serve cancellation anymore.
    if (PICKUP_STARTED_STATUSES.includes(order.status)) {
      return res.status(400).json({
        success: false,
        message:
          "This order is already picked up / in process. Please contact support to cancel it.",
      });
    }

    const placedAt = new Date(order.createdAt).getTime();
    const withinFreeWindow = Date.now() - placedAt <= FREE_CANCELLATION_WINDOW_MS;

    // §8.1 / §8.2 — fee only applies once the free window has passed, and
    // never exceeds what the customer actually paid.
    const cancellationFee = withinFreeWindow
      ? 0
      : Math.min(LATE_CANCELLATION_FEE, order.totalAmount);

    // Only money that was actually collected can be refunded.
    const wasPaid = order.paymentStatus === "paid";
    const refundAmount = wasPaid
      ? Math.max(order.totalAmount - cancellationFee, 0)
      : 0;

    // §8.4 — Company discretion: refunds are issued as wallet credit.
    const refundMode = refundAmount > 0 ? "wallet_credit" : "none";

    order.status = "cancelled";
    order.statusHistory.push({
      status: "cancelled",
      note: withinFreeWindow
        ? "Cancelled by customer within the free-cancellation window"
        : `Cancelled by customer after the free-cancellation window (₹${cancellationFee} fee applied)`,
    });

    order.cancellation = {
      cancelledAt: new Date(),
      cancelledBy: "customer",
      isFreeCancellation: withinFreeWindow,
      cancellationFee,
      refundAmount,
      refundMode,
      // §8.3 allows up to 3–7 working days, but wallet credit is issued
      // instantly rather than left "processing", since it's an internal
      // ledger update rather than a bank/UPI reversal.
      refundStatus: refundAmount > 0 ? "completed" : "not_applicable",
    };

    await order.save();

    let walletBalance = null;

    if (refundAmount > 0) {
      // Resolve the real Customer document via accountId, since
      // order.customerId is the Account _id, not Customer._id.
      const customer = await Customer.findOne({ accountId: order.customerId });

      if (customer) {
        let wallet = await Wallet.findOne({ customerId: customer._id });
        if (!wallet) {
          wallet = await Wallet.create({
            customerId: customer._id,
            balance: 0,
            transactions: [],
          });
        }

        wallet.balance += refundAmount;
        wallet.transactions.push({
          type: "refund",
          amount: refundAmount,
          reason: withinFreeWindow
            ? `Refund for cancelled order ${order.orderNumber}`
            : `Refund for cancelled order ${order.orderNumber} (after ₹${cancellationFee} cancellation fee)`,
          orderId: order._id,
          orderNumber: order.orderNumber,
        });

        await wallet.save();
        walletBalance = wallet.balance;
      }
    }

    return res.json({
      success: true,
      message: withinFreeWindow
        ? "Order cancelled free of charge"
        : `Order cancelled. A ₹${cancellationFee} late cancellation fee was applied`,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        isFreeCancellation: withinFreeWindow,
        cancellationFee,
        refundAmount,
        refundMode,
        refundStatus: order.cancellation.refundStatus,
        walletBalance,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Helper: convert internal status to user-friendly label
const getStepLabel = (status) => {
  const map = {
    pending_sp: 'Order Placed',
    sp_assigned: 'SP Assigned',
    sp_accepted: 'SP Accepted',
    rider_pickup_assigned: 'Rider Assigned for Pickup',
    picked_up: 'Order Picked Up',
    at_sp: 'At Service Provider',
    cleaned: 'Cleaned',
    rider_delivery_assigned: 'Out for Delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
  };
  return map[status] || status;
};

// Helper: build tracking steps from order.statusHistory
const buildTrackingSteps = (order) => {
  const steps = [];
  const history = order.statusHistory || [];
  // Order of steps as per your schema
  const stepOrder = [
    'pending_sp', 'sp_assigned', 'sp_accepted', 'rider_pickup_assigned',
    'picked_up', 'at_sp', 'cleaned', 'rider_delivery_assigned', 'delivered', 'cancelled'
  ];

  for (const stepStatus of stepOrder) {
    const entry = history.find(h => h.status === stepStatus);
    const completed = !!entry;
    const isEstimate = !completed && stepStatus === 'rider_delivery_assigned';
    let time = '';
    if (completed && entry?.updatedAt) {
      time = new Date(entry.updatedAt).toLocaleString();
    } else if (isEstimate && order.status !== 'delivered' && order.status !== 'cancelled') {
      // Estimate based on 'cleaned' time or createdAt + 2 hours
      const baseTime = history.find(h => h.status === 'cleaned')?.updatedAt || order.createdAt;
      if (baseTime) {
        const est = new Date(new Date(baseTime).getTime() + 2 * 60 * 60 * 1000);
        time = `Est. ${est.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
    }
    steps.push({
      label: getStepLabel(stepStatus),
      time,
      completed,
      isEstimate: isEstimate && !completed
    });
  }

  // If order is cancelled, show only up to cancelled step
  if (order.status === 'cancelled') {
    const cancelIdx = steps.findIndex(s => s.label === 'Cancelled');
    return steps.slice(0, cancelIdx + 1);
  }
  // Show all completed steps + next pending step
  const currentIdx = steps.findIndex(s => s.label === getStepLabel(order.status));
  return steps.slice(0, currentIdx + 2);
};

// GET /api/orders/active
exports.getActiveOrder = async (req, res) => {
  try {
    const activeStatuses = [
      'pending_sp', 'sp_assigned', 'sp_accepted', 'rider_pickup_assigned',
      'picked_up', 'at_sp', 'cleaned', 'rider_delivery_assigned'
    ];
    const orders = await Order.find({
      customerId: req.user.id,
      status: { $in: activeStatuses }
    }).sort({ createdAt: -1 });

    if (!orders || orders.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    // Format each order
    const formattedOrders = orders.map(order => {
      const orderSummary = {
        id: order.orderNumber,
        service: order.items[0]?.serviceName || 'Laundry',
        items: order.items.reduce((sum, i) => sum + i.quantity, 0),
        date: new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        price: order.totalAmount,
        status: order.status,
        iconName: 'package-variant'
      };
      const trackingSteps = buildTrackingSteps(order);
      let cancellationDeadline = null;
      if (order.createdAt && order.status === 'pending_sp') {
        cancellationDeadline = new Date(new Date(order.createdAt).getTime() + 2 * 60 * 60 * 1000);
      }
      return {
        order: orderSummary,
        tracking: trackingSteps,
        cancellationDeadline
      };
    });

    res.json({
      success: true,
      data: formattedOrders
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/orders/history
exports.getOrderHistory = async (req, res) => {

  try {
    console.log("USER ID:", req.user.id);


    const historyOrders = await Order.find({
      customerId: req.user.id,
      status: { $in: ['delivered', 'cancelled'] }
    }).sort({ createdAt: -1 });
    console.log("ORDERS FOUND:", historyOrders.length);


    const formatted = historyOrders.map(order => ({
      id: order.orderNumber,
      service: order.items[0]?.serviceName || 'Laundry',
      items: order.items.reduce((sum, i) => sum + i.quantity, 0),
      date: new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      price: order.totalAmount,
      status: order.status === 'delivered' ? 'Delivered' : 'Cancelled',
      iconName: 'package-variant'
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};