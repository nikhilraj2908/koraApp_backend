// routes/washer.routes.js
const express = require("express");
const router = express.Router();
const upload = require('../middleware/upload');
const { washerprotect } = require("../middleware/auth");
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
} = require("../controllers/washerOrderController");

// Auth routes
router.post("/auth/register", upload.fields([
  { name: 'shopPhoto', maxCount: 1 },
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 },
]), register);
router.post("/auth/login", login);
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
    const order = await Order.findByIdAndUpdate(
      req.params.orderId,
      {
        $set: { status: 'rider_pickup_assigned' },
        $push: {
          statusHistory: { status: 'rider_pickup_assigned', updatedAt: new Date() }
        }
      },
      { new: true }  // ← returnDocument: 'after' ki jagah
    );

    if (!order) return res.status(404).json({ message: 'Order not found' });

    emitPickupRiderNeeded(order);

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// washer routes
router.post('/orders/:orderId/complete', washerprotect, async (req, res) => {
  const order = await Order.findByIdAndUpdate(
    req.params.orderId,
    { status: 'completed' },
    { new: true }
  );
  res.json({ success: true, data: order });
});

module.exports = router;
