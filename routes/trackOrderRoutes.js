const express = require("express");
const router  = express.Router();

const {
  trackOrder,
  getActiveOrders,
  getOrderHistory,
  updateOrderStatus,
} = require("../controllers/trackOrderController");

const { protect, restrictTo } = require("../middleware/auth");       


router.get("/active", protect, getActiveOrders);


router.get("/history", protect, getOrderHistory);


router.get("/track/:orderNumber", protect, trackOrder);



router.patch("/:id/status", protect, restrictTo("admin", "subadmin", "rider"), updateOrderStatus);

module.exports = router;