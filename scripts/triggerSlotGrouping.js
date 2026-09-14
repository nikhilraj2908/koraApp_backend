const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();

const connectDB = require('../config/db');
const { runGroupingForSlot } = require('../services/groupingService');
const Order = require('../models/Order');

async function main() {
  await connectDB();
  console.log('[Test] Looking for pending orders awaiting slot...');

  // Find any pending slot & date from existing awaiting_slot orders
  const sampleOrder = await Order.findOne({ dispatchStatus: 'awaiting_slot' }).sort({ createdAt: -1 });
  if (!sampleOrder) {
    console.log('[Test] No orders found with dispatchStatus: "awaiting_slot". Place a test order from customer app first.');
    process.exit(0);
  }

  console.log(`[Test] Found orders for Slot: ${sampleOrder.pickupSlot}, Date: ${sampleOrder.pickupDate}`);
  console.log('[Test] Triggering grouping pipeline now...');

  const groups = await runGroupingForSlot(sampleOrder.pickupSlot, sampleOrder.pickupDate);
  console.log(`[Test] Grouping finished! Created ${groups.length} RideGroup(s).`);
  for (const g of groups) {
    console.log(` - Group ${g._id}: ${g.orderIds.length} orders, totalClothes: ${g.totalClothQuantity}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[Test] Error running grouping:', err);
  process.exit(1);
});
