const express = require("express");
const router = express.Router();

const {
  createOrder,
  getActiveOrder,
  getRecentOrders,
  getOrderDetails,
  updateStatus,
  getOrderHistory,
  cancelOrder
} = require("../controllers/orderController");

// const authMiddleware = require("../middleware/auth");
const { protect } = require("../middleware/auth");

// Create order
router.post(
  "/",
  protect,
  createOrder
);

// Active order
router.get(
  "/active",
  protect,
  getActiveOrder
);

// Recent orders
router.get(
  "/recent",
  protect,
  getRecentOrders
);

router.get('/history', protect,getOrderHistory);

// Single order details
router.get(
  "/:id",
  protect,
  getOrderDetails
);

// Update status
router.put(
  "/:id/status",
  protect,
  updateStatus
);

// Cancel order (dedicated, policy-enforced — Terms §8.1–8.5)
router.post(
  "/:id/cancel",
  protect,
  cancelOrder
);



module.exports = router;