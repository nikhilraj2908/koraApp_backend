// routes/washer.routes.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const upload = require('../middleware/upload');
const { washerprotect } = require("../middleware/auth");
const { authLimiter } = require('../middleware/rateLimiter');
const {
  register,
  login,
  getMe,
  savePushToken,
} = require("../controllers/washerAuthController");
const Order = require('../models/Order'); 
const { emitPickupRiderNeeded } = require('../socket/trackingSocket'); 
const {
  getPendingOrders,
  getMyOrders,
  acceptOrder,
  rejectOrder,
  updateOrderStatus,
  completeOrder,
} = require("../controllers/washerOrderController");
const { emitOrderUpdate } = require("../socket/trackingSocket");

// Auth routes
router.post("/auth/register", authLimiter, upload.fields([
  { name: 'shopPhoto', maxCount: 1 },
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 },
]), register);
router.post("/auth/login", authLimiter, login);
router.get("/auth/me", washerprotect, getMe);
router.patch("/auth/push-token", washerprotect, savePushToken);

// Order routes
router.get("/orders/pending", washerprotect, getPendingOrders);
router.get("/orders/mine", washerprotect, getMyOrders);
router.post("/orders/:id/accept", washerprotect, acceptOrder);
router.post("/orders/:id/reject", washerprotect, rejectOrder);
router.patch("/orders/:id/status", washerprotect, updateOrderStatus);


// router.post('/orders/:orderId/request-pickup-rider', washerprotect, async (req, res) => {
//   try {
//     const order = await Order.findByIdAndUpdate(
//       req.params.orderId,
//       {
//         $set: { status: 'rider_pickup_assigned' },
//         $push: {
//           statusHistory: { status: 'rider_pickup_assigned', updatedAt: new Date() }
//         }
//       },
//       { returnDocument: 'after' }
//     );

//     if (!order) return res.status(404).json({ message: 'Order not found' });

//     emitPickupRiderNeeded(order); // ← req.io ki jagah yeh use karo

//     res.json({ success: true, data: order });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });

router.post('/orders/:orderId/request-pickup-rider', washerprotect, async (req, res) => {
  try {
    const rawId = req.params.orderId;
    const isObjectId = mongoose.Types.ObjectId.isValid(rawId);
    const order = await Order.findOneAndUpdate(
      {
        ...(isObjectId ? { _id: rawId } : { orderNumber: rawId }),
        serviceProviderId: req.user.id || req.user._id,
      },
      {
        $set: { status: 'rider_pickup_assigned' },
        $push: {
          statusHistory: { status: 'rider_pickup_assigned', updatedAt: new Date() }
        }
      },
      { new: true }
    );

    if (!order) return res.status(404).json({ message: 'Order not found or unauthorized' });

    emitPickupRiderNeeded(order);
    emitOrderUpdate(order);

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Washer completes laundry processing -> sets status to 'cleaned'
router.post('/orders/:orderId/complete', washerprotect, completeOrder);
router.post('/orders/:id/complete', washerprotect, completeOrder);

module.exports = router;
