const mongoose = require("mongoose");
const Order = require("../models/Order");
const Washer = require("../models/Washer");
const WasherGroupOffer = require("../models/WasherGroupOffer");
const { sendPushNotification, notifyCustomer } = require("../utils/notification");
const { emitOrderUpdate } = require("../socket/trackingSocket");
const { acceptWasherOffer } = require("../services/washerAuctionService");
const { WASHER_GROUP_OFFER_STATUS } = require("../constants/dispatchConstants");

// ─────────────────────────────────────────────────────────────
// EXISTING ORDER ENDPOINTS (kept for backward compat)
// ─────────────────────────────────────────────────────────────

// GET all pending orders (washer dashboard — legacy view)
// Orders managed by the dispatch system (awaiting_slot, grouped, offer_pending) are excluded
// because they must be accepted as optimized groups via WasherGroupOffer.
exports.getPendingOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      status: "pending_sp",
      dispatchStatus: { $nin: ["awaiting_slot", "grouped", "offer_pending"] },
    }).sort({ createdAt: -1 });
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
      status: { $in: ["washer_assigned", "sp_accepted", "at_sp", "cleaned"] }
    }).sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST accept individual order (legacy — blocked if order is awaiting slot dispatch)
exports.acceptOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    if (order.status !== "pending_sp" || order.dispatchStatus === "awaiting_slot") {
      return res.status(400).json({
        success: false,
        message: "This order is managed by slot dispatch and will be bundled into a group offer.",
      });
    }

    order.status = "sp_accepted";
    order.serviceProviderId = req.user.id;
    order.statusHistory.push({ status: "sp_accepted" });
    await order.save();

    notifyCustomer(order.customerId, {
      title: "Order Accepted! 🎉",
      body: `Your order ${order.orderNumber} has been accepted by a service provider.`,
      type: "order_accepted",
      orderId: order._id,
      orderNumber: order.orderNumber,
    });

    emitOrderUpdate(order);
    res.json({ success: true, message: "Order accepted", data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST reject order (legacy)
exports.rejectOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (String(order.serviceProviderId) === String(req.user.id)) {
      order.serviceProviderId = null;
    }
    await order.save();
    res.json({ success: true, message: "Order rejected" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH update order status (at_sp / cleaned)
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["at_sp", "cleaned"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const rawId = req.params.id;
    const isObjectId = mongoose.Types.ObjectId.isValid(rawId);
    const order = await Order.findOne({
      ...(isObjectId ? { _id: rawId } : { orderNumber: rawId }),
      serviceProviderId: req.user.id,
    });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    order.status = status;
    order.statusHistory.push({ status, updatedAt: new Date() });

    if (status === "cleaned" && !order.estimatedDelivery) {
      const estDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
      order.estimatedDelivery = estDate;
      order.estimatedDeliveryTime = estDate;
    }

    await order.save();

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

    emitOrderUpdate(order);
    res.json({ success: true, message: "Status updated", data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST mark order as cleaned (complete)
exports.completeOrder = async (req, res) => {
  try {
    const orderId = req.params.orderId || req.params.id;
    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const order = await Order.findOne({
      ...(isObjectId ? { _id: orderId } : { orderNumber: orderId }),
      serviceProviderId: req.user.id || req.user._id,
    });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found or unauthorized" });
    }

    if (order.status === "cleaned") {
      return res.json({ success: true, message: "Order is already marked as cleaned", data: order });
    }

    order.status = "cleaned";
    order.statusHistory.push({
      status: "cleaned",
      note: "Laundry processing completed by washer",
      updatedAt: new Date(),
    });

    if (!order.estimatedDelivery) {
      const estDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
      order.estimatedDelivery = estDate;
      order.estimatedDeliveryTime = estDate;
    }

    await order.save();

    notifyCustomer(order.customerId, {
      title: "Order Update",
      body: "Your clothes are cleaned and ready for pickup! 👕",
      type: "order_cleaned",
      orderId: order._id,
      orderNumber: order.orderNumber,
    });

    emitOrderUpdate(order);
    return res.json({ success: true, message: "Order marked as cleaned successfully", data: order });
  } catch (err) {
    console.error("[completeOrder] error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// NEW: GROUP OFFER ENDPOINTS
// ─────────────────────────────────────────────────────────────

/**
 * GET /api/washer/group-offers/pending
 * Returns all active WasherGroupOffers that include this washer in the
 * notifiedWasherIds list. Called on app load/reconnect to restore state.
 */
exports.getPendingGroupOffers = async (req, res) => {
  try {
    const washerId = req.user.id;
    const offers = await WasherGroupOffer.find({
      status: WASHER_GROUP_OFFER_STATUS.PENDING,
      notifiedWasherIds: washerId,
      expiresAt: { $gt: new Date() },
    })
      .populate({
        path: "pickupSequence",
        select: "orderNumber pickupAddress pickupLocation clothQuantity",
      })
      .lean();

    res.json({ success: true, count: offers.length, data: offers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/washer/group-offers/:offerId/accept
 * Atomically accepts a WasherGroupOffer. If another washer already
 * accepted, returns 409 Conflict.
 */
exports.acceptGroupOffer = async (req, res) => {
  try {
    const { offerId } = req.params;
    const washerId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(offerId)) {
      return res.status(400).json({ success: false, message: "Invalid offer ID" });
    }

    // Verify this washer was actually notified about this offer
    const offer = await WasherGroupOffer.findOne({
      _id: offerId,
      notifiedWasherIds: washerId,
    });
    if (!offer) {
      return res.status(404).json({ success: false, message: "Offer not found or you were not notified" });
    }
    if (offer.status !== WASHER_GROUP_OFFER_STATUS.PENDING) {
      return res.status(409).json({
        success: false,
        message: "Offer is no longer available",
        status: offer.status,
      });
    }

    const accepted = await acceptWasherOffer(offerId, washerId);

    if (!accepted) {
      return res.status(409).json({
        success: false,
        message: "Another washer accepted this offer first",
      });
    }

    return res.json({
      success: true,
      message: "Group accepted — rider dispatch has been started",
      data: { offerId: String(accepted._id), rideGroupId: String(accepted.rideGroupId) },
    });
  } catch (err) {
    console.error("[acceptGroupOffer] error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/washer/group-offers/:offerId/reject
 * Washer explicitly rejects the offer. The offer stays pending for other
 * washers — rejection from one washer doesn't expire the offer.
 */
exports.rejectGroupOffer = async (req, res) => {
  try {
    const { offerId } = req.params;
    const washerId = req.user.id;

    const offer = await WasherGroupOffer.findOne({
      _id: offerId,
      notifiedWasherIds: washerId,
      status: WASHER_GROUP_OFFER_STATUS.PENDING,
    });

    if (!offer) {
      return res.status(404).json({ success: false, message: "Offer not found or already resolved" });
    }

    // Remove this washer from notified list so they don't keep seeing it.
    await WasherGroupOffer.updateOne(
      { _id: offerId },
      { $pull: { notifiedWasherIds: new mongoose.Types.ObjectId(washerId) } }
    );

    return res.json({ success: true, message: "Offer rejected" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// WASHER LOCATION UPDATE
// ─────────────────────────────────────────────────────────────

/**
 * PATCH /api/washer/auth/location
 * Updates the washer's shopLocation so the dispatch system can find them
 * in $near queries. Body: { lng: number, lat: number }
 */
exports.updateWasherLocation = async (req, res) => {
  try {
    const rawLng = req.body.lng !== undefined ? req.body.lng : req.body.longitude;
    const rawLat = req.body.lat !== undefined ? req.body.lat : req.body.latitude;
    const lng = Number(rawLng);
    const lat = Number(rawLat);

    if (Number.isNaN(lng) || Number.isNaN(lat)) {
      return res.status(400).json({ success: false, message: "Body must include numeric lng/lat or longitude/latitude" });
    }
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return res.status(400).json({ success: false, message: "Invalid coordinates" });
    }

    const washer = await Washer.findByIdAndUpdate(
      req.user.id,
      { $set: { shopLocation: { type: "Point", coordinates: [lng, lat] } } },
      { new: true }
    ).select("name shopAddress shopLocation");

    if (!washer) {
      return res.status(404).json({ success: false, message: "Washer not found" });
    }

    return res.json({
      success: true,
      message: "Shop location updated",
      data: { shopLocation: washer.shopLocation },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};