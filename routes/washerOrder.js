// routes/washerOrder.routes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth"); // same middleware, role check neeche
const {
  getPendingOrders,
  getMyOrders,
  acceptOrder,
  rejectOrder,
  updateOrderStatus,
} = require("../controllers/washerOrderController");
const { login, savePushToken } = require("../controllers/washerAuthController");

// Auth
router.post("/auth/login", login);
router.patch("/auth/push-token", protect, savePushToken);

// Orders
router.get("/orders/pending", protect, getPendingOrders);
router.get("/orders/mine", protect, getMyOrders);
router.post("/orders/:id/accept", protect, acceptOrder);
router.post("/orders/:id/reject", protect, rejectOrder);
router.patch("/orders/:id/status", protect, updateOrderStatus);

module.exports = router;