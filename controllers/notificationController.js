const Notification = require("../models/Notification");
const Customer = require("../models/Customer");
const { sendPushNotification } = require("../utils/notification");

// GET /api/notifications — this customer's notification history
exports.getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ accountId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100);

    const unreadCount = notifications.filter((n) => !n.read).length;

    res.json({
      success: true,
      data: notifications,
      unreadCount,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/notifications/:id/read
exports.markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      accountId: req.user.id, // ensure a customer can only mark their own
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    notification.read = true;
    await notification.save();

    res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/notifications/read-all
exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { accountId: req.user.id, read: false },
      { $set: { read: true } }
    );

    res.json({ success: true, message: "All notifications marked as read" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/notifications/push-token — save this device's Expo push token
exports.registerPushToken = async (req, res) => {
  try {
    const { pushToken } = req.body;

    if (!pushToken) {
      return res.status(400).json({ success: false, message: "pushToken is required" });
    }

    const customer = await Customer.findOneAndUpdate(
      { accountId: req.user.id },
      { $set: { expoPushToken: pushToken } },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer profile not found" });
    }

    res.json({ success: true, message: "Push token registered" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/notifications/preference
exports.getNotificationPreference = async (req, res) => {
  try {
    const customer = await Customer.findOne({ accountId: req.user.id });

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer profile not found" });
    }

    res.json({
      success: true,
      data: { notificationsEnabled: customer.notificationsEnabled !== false },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/notifications/preference
exports.updateNotificationPreference = async (req, res) => {
  try {
    const { notificationsEnabled } = req.body;

    if (typeof notificationsEnabled !== "boolean") {
      return res.status(400).json({ success: false, message: "notificationsEnabled must be true or false" });
    }

    const customer = await Customer.findOneAndUpdate(
      { accountId: req.user.id },
      { $set: { notificationsEnabled } },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer profile not found" });
    }

    res.json({
      success: true,
      data: { notificationsEnabled: customer.notificationsEnabled },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/notifications/broadcast — admin only, sends to every customer
// who has a push token and hasn't disabled notifications.
exports.broadcastNotification = async (req, res) => {
  try {
    const { title, body } = req.body;

    if (!title || !body) {
      return res.status(400).json({ success: false, message: "title and body are required" });
    }

    const customers = await Customer.find({
      notificationsEnabled: { $ne: false },
    });

    const notificationDocs = customers.map((c) => ({
      accountId: c.accountId,
      title,
      body,
      type: "admin_broadcast",
    }));

    if (notificationDocs.length > 0) {
      await Notification.insertMany(notificationDocs);
    }

    // Fire pushes in parallel — don't let one failed token block the rest.
    await Promise.all(
      customers
        .filter((c) => c.expoPushToken)
        .map((c) => sendPushNotification(c.expoPushToken, { title, body, data: { type: "admin_broadcast" } }))
    );

    res.json({
      success: true,
      message: `Broadcast sent to ${notificationDocs.length} customers`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};