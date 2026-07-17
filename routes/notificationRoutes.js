const express = require("express");
const router = express.Router();

const { protect, restrictTo } = require("../middleware/auth");
const {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  registerPushToken,
  getNotificationPreference,
  updateNotificationPreference,
  broadcastNotification,
} = require("../controllers/notificationController");

// Customer routes
router.get("/", protect, getMyNotifications);
router.patch("/read-all", protect, markAllAsRead);
router.patch("/:id/read", protect, markAsRead);
router.post("/push-token", protect, registerPushToken);
router.get("/preference", protect, getNotificationPreference);
router.patch("/preference", protect, updateNotificationPreference);

// Admin route
router.post("/broadcast", protect, restrictTo("admin"), broadcastNotification);

module.exports = router;