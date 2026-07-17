// utils/notification.js
const { Expo } = require("expo-server-sdk");
const expo = new Expo();

const sendPushNotification = async (pushToken, { title, body, data = {} }) => {
  if (!pushToken || !Expo.isExpoPushToken(pushToken)) return;
  try {
    await expo.sendPushNotificationsAsync([{
      to: pushToken,
      sound: "default",
      title,
      body,
      data,
    }]);
  } catch (err) {
    console.log("Push notification error:", err.message);
  }
};
exports.sendPushNotification = sendPushNotification;

/**
 * Saves an in-app notification (so it shows up in the customer's
 * notification history) and sends a push if the customer has one enabled.
 *
 * @param {string|ObjectId} accountId - This MUST be the Account _id, not
 *   Customer._id — matches Order.customerId, req.user.id, etc. throughout
 *   this codebase. Passing a Customer._id here will silently find nothing.
 * @param {object} payload - { title, body, type, orderId, orderNumber }
 */
exports.notifyCustomer = async (accountId, { title, body, type = "general", orderId, orderNumber }) => {
  try {
    // Lazy-required to avoid a circular-require risk between models/controllers.
    const Customer = require("../models/Customer");
    const Notification = require("../models/Notification");

    const customer = await Customer.findOne({ accountId });
    if (!customer) {
      console.log(`notifyCustomer: no Customer found for accountId ${accountId}`);
      return;
    }

    // Always save to history — even if push is disabled, the customer
    // should still see this in their in-app notification list.
    await Notification.create({
      accountId,
      title,
      body,
      type,
      orderId,
      orderNumber,
    });

    // Respect the customer's push preference (defaults to true if unset).
    if (customer.notificationsEnabled === false) return;

    if (customer.expoPushToken) {
      await sendPushNotification(customer.expoPushToken, {
        title,
        body,
        data: { orderNumber, type },
      });
    }
  } catch (err) {
    // Never let a notification failure break the calling order/status flow.
    console.log("notifyCustomer failed:", err.message);
  }
};