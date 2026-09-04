const express = require('express');
const { enrollRider, getProfile, updateProfile } = require('../controllers/riderController');
const { riderProtect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const Account = require('../models/Account');
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken');
const router = express.Router();
const { emitOrderUpdate } = require('../socket/trackingSocket');
const { notifyAdmins, notifyCustomer } = require('../utils/notification');
const { authLimiter } = require('../middleware/rateLimiter');

router.post('/enroll', authLimiter, upload.fields([
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'drivingLicense', maxCount: 1 },
  { name: 'rc', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 }
]), enrollRider);

// ── Assigned Orders ──────────────────────────────────────────
// FIXED: this previously returned EVERY rider's assigned orders with no
// filter at all — any authenticated rider could see every other rider's
// pickups/deliveries. Now scoped to orders actually assigned to the
// requesting rider (as either the pickup or delivery rider).
router.get('/orders/assigned', riderProtect, async (req, res) => {
  try {
    const riderId = req.rider._id;
    console.log('[Rider] Fetching assigned orders for rider:', riderId);

    const orders = await Order.find({
      status: { $in: ['rider_pickup_assigned', 'picked_up', 'rider_delivery_assigned', 'delivered'] },
      $or: [{ riderPickupId: riderId }, { riderDeliveryId: riderId }],
    });

    console.log('[Rider] Found orders:', orders.length);
    res.json({ success: true, data: orders });
  } catch (err) {
    console.log('[Rider] Error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── Accept / Reject — DEPRECATED, DISABLED ──────────────────────
// These predate the group/auction dispatch system (Phases 1-4) and let
// ANY authenticated rider directly claim ANY order by its raw Mongo _id,
// with zero exclusivity lock (two riders racing this would both
// "succeed") and zero connection to RideGroup/RideOffer/Assignment —
// completely bypassing the entire dispatch pipeline. Disabled rather
// than deleted outright, so any client still pointed at these gets a
// clear, actionable error instead of a bare 404.
//
// Use instead: POST /api/ride-offers/:id/accept (see
// controllers/rideOfferController.js), which goes through
// services/auctionService.js's atomic, transaction-safe acceptOffer().
router.post('/orders/:id/accept', riderProtect, (req, res) => {
  res.status(410).json({
    success: false,
    message: 'This endpoint is disabled. Ride pickups are now claimed via POST /api/ride-offers/:id/accept.',
  });
});

router.post('/orders/:id/reject', riderProtect, (req, res) => {
  res.status(410).json({
    success: false,
    message: 'This endpoint is disabled and no longer has any effect.',
  });
});

// ── Picked Up ────────────────────────────────────────────────
// Rider confirms pickup of laundry from customer.
// Enforces ownership (must be the assigned pickup rider) and valid state transition.
router.post('/orders/:id/picked-up', riderProtect, async (req, res) => {
  try {
    const order = await Order.findOneAndUpdate(
      {
        _id: req.params.id,
        riderPickupId: req.rider._id,
        status: 'rider_pickup_assigned',
      },
      {
        $set: { status: 'picked_up', riderStatus: 'picked_up' },
        $push: {
          statusHistory: {
            status: 'picked_up',
            note: `Clothes picked up by rider ${req.rider.fullName || ''}`.trim(),
            updatedAt: new Date(),
          },
        },
      },
      {
        new: true,
        populate: [
          { path: 'riderPickupId', select: 'name fullName phone' },
          { path: 'riderDeliveryId', select: 'name fullName phone' },
        ],
      }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found, unauthorized (not assigned to you), or not in pickup assigned status',
      });
    }

    notifyCustomer(order.customerId, {
      title: 'Clothes Picked Up 🧺',
      body: `Your clothes for order #${order.orderNumber} have been picked up and are on the way to the washer!`,
      type: 'order_picked_up',
      orderId: order._id,
      orderNumber: order.orderNumber,
    });

    emitOrderUpdate(order);

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Delivered ────────────────────────────────────────────────
// Rider confirms delivery of clean laundry back to customer.
// Enforces ownership (must be the assigned delivery rider) and valid state transition.
router.post('/orders/:id/delivered', riderProtect, async (req, res) => {
  try {
    const order = await Order.findOneAndUpdate(
      {
        _id: req.params.id,
        riderDeliveryId: req.rider._id,
        status: 'rider_delivery_assigned',
      },
      {
        $set: { status: 'delivered', riderStatus: 'delivered' },
        $push: {
          statusHistory: {
            status: 'delivered',
            note: `Clothes delivered by rider ${req.rider.fullName || ''}`.trim(),
            updatedAt: new Date(),
          },
        },
      },
      {
        new: true,
        populate: [
          { path: 'riderPickupId', select: 'name fullName phone' },
          { path: 'riderDeliveryId', select: 'name fullName phone' },
        ],
      }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found, unauthorized (not assigned to you), or not in delivery assigned status',
      });
    }

    notifyCustomer(order.customerId, {
      title: 'Order Delivered! 🎉',
      body: `Your order #${order.orderNumber} has been delivered. Thank you for choosing Kora!`,
      type: 'order_delivered',
      orderId: order._id,
      orderNumber: order.orderNumber,
    });

    emitOrderUpdate(order);

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
// ── Register / Enroll ────────────────────────────────────────
router.post(
  '/auth/register',
  authLimiter,
  upload.fields([
    { name: 'aadhaarFront', maxCount: 1 },
    { name: 'aadhaarBack', maxCount: 1 },
    { name: 'drivingLicense', maxCount: 1 },
    { name: 'rc', maxCount: 1 },
    { name: 'profilePhoto', maxCount: 1 },
  ]),
  enrollRider
);

router.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const { mobile, password } = req.body;

    // Mobile se Account dhundo
    const account = await Account.findOne({ mobile }).select('+password');
    if (!account) return res.status(401).json({ message: 'Mobile number not found' });

    // Role check
    if (account.role !== 'rider') {
      return res.status(401).json({ message: 'This account is not a rider' });
    }

    const isMatch = await bcrypt.compare(password, account.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid password' });

    // Rider profile dhundo
    const rider = await Rider.findOne({ accountId: account._id });
    if (!rider) return res.status(401).json({ message: 'Rider profile not found' });

    const token = jwt.sign(
      { id: account._id, role: 'rider', riderId: rider._id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      rider: {
        _id: rider._id,
        id: rider._id,
        name: rider.fullName,
        mobile: account.mobile,
        email: account.email,
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});



router.get('/profile', riderProtect, restrictTo('rider'), getProfile);
router.put('/profile', riderProtect, restrictTo('rider'), updateProfile);

// ── Live location (dispatch system) ─────────────────────────────
// Rider app should call this on a steady interval (e.g. every 10-15s)
// while the app is open — this is what populates the 2dsphere-indexed
// field repositories/riderRepository.js's findNearbyAvailableRiders
// actually queries against for ride-offer discovery.
router.patch('/location', riderProtect, restrictTo('rider'), async (req, res) => {
  try {
    const { longitude, latitude } = req.body;

    if (typeof longitude !== 'number' || typeof latitude !== 'number') {
      return res.status(400).json({ success: false, message: 'longitude and latitude (numbers) are required' });
    }

    await Rider.updateOne(
      { _id: req.rider._id },
      {
        $set: {
          currentLocation: { type: 'Point', coordinates: [longitude, latitude] },
          locationUpdatedAt: new Date(),
        },
      }
    );

    res.json({ success: true, message: 'Location updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Online / availability toggle ────────────────────────────────
// isOnline: rider has the app open and wants to receive offers at all.
// isAvailable: online but not mid-delivery — set to false automatically
// by services/auctionService.js's acceptOffer, and should be set back
// to true by the rider app once a delivery completes.
router.patch('/availability', riderProtect, restrictTo('rider'), async (req, res) => {
  try {
    const { isOnline, isAvailable } = req.body;
    const update = {};

    if (typeof isOnline === 'boolean') update.isOnline = isOnline;
    if (typeof isAvailable === 'boolean') update.isAvailable = isAvailable;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: 'isOnline and/or isAvailable (booleans) required' });
    }

    const rider = await Rider.findOneAndUpdate(
      { _id: req.rider._id },
      { $set: update },
      { new: true }
    );

    res.json({
      success: true,
      data: { isOnline: rider.isOnline, isAvailable: rider.isAvailable },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
router.patch('/push-token', riderProtect, async (req, res) => {
  try {
    const { expoPushToken } = req.body;
 
    if (!expoPushToken) {
      return res.status(400).json({ success: false, message: 'expoPushToken is required' });
    }
 
    await Rider.findByIdAndUpdate(req.rider._id, { expoPushToken });
    res.json({ success: true, message: 'Push token saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
module.exports = router;