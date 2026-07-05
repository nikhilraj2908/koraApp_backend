const Order = require("../models/Order");
const Service = require("../models/Servicemodel");
const Customer = require("../models/Customer");
const WalletTransaction = require("../models/WalletCustomer");
const { emitNewOrderToWashers } = require('../socket/trackingSocket');

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


// ─────────────────────────────────────────────────────────────
// CANCEL ORDER (Customer-initiated)
// Implements Cancellation & Refund Policy §8:
//   8.1 Free cancellation within 2 hours of placement, if pickup hasn't started
//   8.2 Late cancellation (after 2 hours, still before pickup) → ₹50 fee
//   8.4 Refund issued as wallet credit (Company's discretion)
//   8.5 No cancellation once the service has actually started (picked up) —
//       from that point on, only a damage complaint can lead to a refund.
// ─────────────────────────────────────────────────────────────
const FREE_CANCELLATION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const LATE_CANCELLATION_FEE = 50;

// Statuses where the order can still be cancelled — i.e. pickup hasn't
// happened yet. Anything from "picked_up" onward is past that point.
const CANCELLABLE_STATUSES = [
  "pending_sp",
  "sp_assigned",
  "sp_accepted",
  "rider_pickup_assigned",
];

exports.cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // Ownership check — only the customer who placed the order can cancel it
    if (String(order.customerId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "You are not allowed to cancel this order" });
    }

    if (order.status === "cancelled") {
      return res.status(400).json({ success: false, message: "This order is already cancelled" });
    }

    if (order.status === "delivered") {
      return res.status(400).json({
        success: false,
        message: "This order has already been completed. If something was damaged, please raise a complaint instead.",
      });
    }

    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: "This order can no longer be cancelled as pickup has already started. Please contact support if needed.",
      });
    }

    const elapsedMs = Date.now() - new Date(order.createdAt).getTime();
    const isWithinFreeWindow = elapsedMs <= FREE_CANCELLATION_WINDOW_MS;

    const fee = isWithinFreeWindow ? 0 : Math.min(LATE_CANCELLATION_FEE, order.totalAmount);
    const refundAmount = Math.max(order.totalAmount - fee, 0);

    order.status = "cancelled";
    order.cancelledAt = new Date();
    order.cancelledBy = "customer";
    order.cancellationFee = fee;
    order.refundAmount = refundAmount;
    order.statusHistory.push({
      status: "cancelled",
      note: fee > 0
        ? `Cancelled by customer (late cancellation, ₹${fee} fee applied)`
        : "Cancelled by customer (free cancellation)",
    });

    await order.save();

    // 8.4: Refund issued as wallet credit
    // NOTE: order.customerId stores the Account id (matching the rest of
    // this codebase's convention), not the Customer document's own _id —
    // so we resolve the actual Customer record via accountId first.
    if (refundAmount > 0) {
      const customer = await Customer.findOneAndUpdate(
        { accountId: order.customerId },
        { $inc: { walletBalance: refundAmount } },
        { new: true }
      );

      if (customer) {
        await WalletTransaction.create({
          customerId: customer._id,
          type: "credit",
          amount: refundAmount,
          reason: `Refund for cancelled order #${order.orderNumber}`,
          orderId: order._id,
        });
      }
    }

    res.json({
      success: true,
      message: fee > 0
        ? `Order cancelled. A ₹${fee} late-cancellation fee was applied — ₹${refundAmount} has been credited to your wallet.`
        : "Order cancelled for free. Any amount paid has been credited to your wallet.",
      data: {
        status: order.status,
        cancellationFee: fee,
        refundAmount,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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
      time = new Date(entry.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    } else if (isEstimate && order.status !== 'delivered' && order.status !== 'cancelled') {
      // Estimate based on 'cleaned' time or createdAt + 2 hours
      const baseTime = history.find(h => h.status === 'cleaned')?.updatedAt || order.createdAt;
      if (baseTime) {
        const est = new Date(new Date(baseTime).getTime() + 2 * 60 * 60 * 1000);
        time = `Est. ${est.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: "Asia/Kolkata" })}`;
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
        date: new Date(order.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Kolkata' }),
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
      date: new Date(order.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Kolkata' }),
      price: order.totalAmount,
      status: order.status === 'delivered' ? 'Delivered' : 'Cancelled',
      iconName: 'package-variant'
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};