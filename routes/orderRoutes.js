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
const upload = require("../middleware/upload");

// Create order
// upload.fields(...) only activates for multipart/form-data requests (i.e.
// when the customer attaches wash/iron cloth photos) — a plain
// application/json request with no photos passes through untouched, so
// this doesn't change the existing JSON-only flow at all.
router.post(
  "/",
  protect,
  upload.fields([
    { name: "washPhotos", maxCount: 4 },
    { name: "ironPhotos", maxCount: 4 },
  ]),
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