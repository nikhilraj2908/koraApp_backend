// Placeholder for notification logic
const notifyServiceProvider = async (serviceProviderId, orderId, amount) => {
  console.log(`[NOTIFICATION] To SP ${serviceProviderId}: Order ${orderId} offered ₹${amount}`);
  // Later: implement push notifications, SMS, or WebSocket
};

module.exports = { notifyServiceProvider };