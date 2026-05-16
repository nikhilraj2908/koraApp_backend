const express = require("express");
const router = express.Router();

const {
  createOrder,
  getActiveOrder,
  getRecentOrders,
  getOrderDetails,
  updateStatus
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

module.exports = router;