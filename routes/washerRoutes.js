// routes/washer.routes.js
const express = require("express");
const router = express.Router();
const { washerprotect } = require("../middleware/auth");
const {
  register,
  login,
  getMe,
  savePushToken,
} = require("../controllers/washerAuthController");
const {
  getPendingOrders,
  getMyOrders,
  acceptOrder,
  rejectOrder,
  updateOrderStatus,
} = require("../controllers/washerOrderController");

// Auth routes
router.post("/auth/register", register);
router.post("/auth/login", login);
router.get("/auth/me", washerprotect, getMe);
router.patch("/auth/push-token", washerprotect, savePushToken);

// Order routes
router.get("/orders/pending", washerprotect, getPendingOrders);
router.get("/orders/mine", washerprotect, getMyOrders);
router.post("/orders/:id/accept", washerprotect, acceptOrder);
router.post("/orders/:id/reject", washerprotect, rejectOrder);
router.patch("/orders/:id/status", washerprotect, updateOrderStatus);

module.exports = router;