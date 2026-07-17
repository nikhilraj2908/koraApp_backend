// controllers/washerOrderController.js
const Order = require("../models/Order");
const Washer = require("../models/Washer");
const { sendPushNotification, notifyCustomer } = require("../utils/notification");

// GET all pending orders (washer dashboard)
exports.getPendingOrders = async (req, res) => {
  try {
    const orders = await Order.find({ status: "pending_sp" })
      .sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET washer's accepted orders
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      serviceProviderId: req.user.id,
      status: { $in: ["sp_accepted", "at_sp", "cleaned"] }
    }).sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST accept order
exports.acceptOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (order.status !== "pending_sp") {
      return res.status(400).json({ success: false, message: "Order already taken" });
    }

    order.status = "sp_accepted";
    order.serviceProviderId = req.user.id;
    order.statusHistory.push({ status: "sp_accepted" });
    await order.save();

    // Customer ko notify karo
    // NOTE: order.customerId is the Account _id (see createOrder /
    // req.user.id), not Customer._id — the previous Customer.findById(...)
    // here was silently finding nothing, so this notification never fired.
    // notifyCustomer resolves this correctly internally.
    notifyCustomer(order.customerId, {
      title: "Order Accepted! 🎉",
      body: `Your order ${order.orderNumber} has been accepted by a service provider.`,
      type: "order_accepted",
      orderId: order._id,
      orderNumber: order.orderNumber,
    });

    res.json({ success: true, message: "Order accepted", data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST reject order
exports.rejectOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // Just release it back — don't change status, another washer can pick it
    if (String(order.serviceProviderId) === String(req.user.id)) {
      order.serviceProviderId = null;
    }
    await order.save();

    res.json({ success: true, message: "Order rejected" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH update order status (washing → at_sp → cleaned)
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["at_sp", "cleaned"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      serviceProviderId: req.user.id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    order.status = status;
    order.statusHistory.push({ status });
    await order.save();

    // Customer ko notify
    // NOTE: same fix as acceptOrder above — order.customerId is the
    // Account _id, not Customer._id.
    const messages = {
      at_sp: "Your clothes have arrived at the service provider.",
      cleaned: "Your clothes are cleaned and ready for pickup! 👕",
    };
    const typeByStatus = { at_sp: "order_at_sp", cleaned: "order_cleaned" };
    notifyCustomer(order.customerId, {
      title: "Order Update",
      body: messages[status],
      type: typeByStatus[status] || "general",
      orderId: order._id,
      orderNumber: order.orderNumber,
    });

    res.json({ success: true, message: "Status updated", data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};