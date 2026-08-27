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

// Which permission (see constants/permissions.js) a sub-admin needs before
// they're bothered with a given admin-facing notification type. The super
// admin always gets every notification regardless of this map.
const ADMIN_NOTIFICATION_PERMISSION = {
  rider_signup: "riders.view",
  washer_signup: "washers.view",
  complaint_raised: "complaints.view",
};

/**
 * Fans an admin-facing notification (bell icon) out to every admin/subadmin
 * who should see it: the super admin always, and each sub-admin only if
 * they hold the permission relevant to this notification's `type` (so a
 * sub-admin who can't view riders doesn't get pinged about rider signups
 * they have no way to act on).
 *
 * @param {object} payload
 * @param {'rider_signup'|'washer_signup'|'complaint_raised'} payload.type
 * @param {string} payload.title
 * @param {string} payload.body
 * @param {string|ObjectId} payload.referenceId - the Rider/Washer/Complaint _id
 * @param {'Rider'|'Washer'|'Complaint'} payload.referenceModel
 */
exports.notifyAdmins = async ({ type, title, body, referenceId, referenceModel }) => {
  try {
    // Lazy-required for the same reason as above — avoids a circular
    // require between models/controllers/utils at module-load time.
    const Admin = require("../models/Admin");
    const Notification = require("../models/Notification");
    let emitAdminNotification;
    try {
      ({ emitAdminNotification } = require("../socket/trackingSocket"));
    } catch {
      emitAdminNotification = null; // socket module not initialized yet — fine, REST still works
    }

    const requiredPermission = ADMIN_NOTIFICATION_PERMISSION[type];

    const admins = await Admin.find({
      isActive: true,
      $or: [
        { level: "admin" }, // super admin — always notified
        { level: "subadmin", permissions: requiredPermission },
      ],
    });

    if (admins.length === 0) return;

    const docs = admins.map((a) => ({
      accountId: a.accountId,
      title,
      body,
      type,
      referenceId,
      referenceModel,
    }));

    const created = await Notification.insertMany(docs);

    // Best-effort real-time push over socket.io, if it's set up — the
    // REST list (GET /api/notifications) is always the source of truth,
    // this is just so the bell can update without a page refresh.
    if (emitAdminNotification) {
      created.forEach((n) => emitAdminNotification(String(n.accountId), n));
    }
  } catch (err) {
    // Never let a notification failure break the calling
    // registration/complaint flow.
    console.log("notifyAdmins failed:", err.message);
  }
};