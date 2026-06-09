// utils/notification.js
const { Expo } = require("expo-server-sdk");
const expo = new Expo();

exports.sendPushNotification = async (pushToken, { title, body, data = {} }) => {
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