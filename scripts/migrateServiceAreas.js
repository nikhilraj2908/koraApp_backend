/**
 * scripts/migrateServiceAreas.js
 *
 * Migration script to backfill `serviceAreaId` on existing Riders, Washers,
 * ServiceProviders, Customers, and Orders based strictly on geospatial coordinates
 * falling within the active service area boundaries (NOT inferred from free-text city names).
 *
 * Usage:
 *   node scripts/migrateServiceAreas.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const ServiceArea = require('../models/ServiceArea');
const Rider = require('../models/Rider');
const Washer = require('../models/Washer');
const ServiceProvider = require('../models/ServiceProvider');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const { isPointInServiceArea } = require('../utils/geoJsonValidator');

async function migrate() {
  console.log('--- Starting Service Area Migration ---');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB.');

  const activeArea = await ServiceArea.findOne({ status: 'active' });
  if (!activeArea) {
    console.log('No active service area found. Please create and activate a service area before running migration.');
    process.exit(0);
  }

  console.log(`Active Service Area: "${activeArea.name}" (${activeArea._id})`);

  let updatedRiders = 0;
  let updatedWashers = 0;
  let updatedSPs = 0;
  let updatedOrders = 0;
  let updatedCustomers = 0;

  // 1. Backfill Riders
  const riders = await Rider.find({ serviceAreaId: null });
  for (const rider of riders) {
    if (rider.currentLocation?.coordinates && isPointInServiceArea(rider.currentLocation.coordinates, activeArea.boundary)) {
      rider.serviceAreaId = activeArea._id;
      await rider.save();
      updatedRiders++;
    }
  }

  // 2. Backfill Washers
  const washers = await Washer.find({ serviceAreaId: null });
  for (const washer of washers) {
    if (washer.shopLocation?.coordinates && isPointInServiceArea(washer.shopLocation.coordinates, activeArea.boundary)) {
      washer.serviceAreaId = activeArea._id;
      await washer.save();
      updatedWashers++;
    }
  }

  // 3. Backfill ServiceProviders
  const sps = await ServiceProvider.find({ serviceAreaId: null });
  for (const sp of sps) {
    if (sp.location?.coordinates && isPointInServiceArea(sp.location.coordinates, activeArea.boundary)) {
      sp.serviceAreaId = activeArea._id;
      await sp.save();
      updatedSPs++;
    }
  }

  // 4. Backfill Orders
  const orders = await Order.find({ serviceAreaId: null });
  for (const order of orders) {
    if (order.pickupLocation?.coordinates && isPointInServiceArea(order.pickupLocation.coordinates, activeArea.boundary)) {
      order.serviceAreaId = activeArea._id;
      await order.save();
      updatedOrders++;
    }
  }

  // 5. Backfill Customers
  const customers = await Customer.find({ serviceAreaId: null });
  for (const cust of customers) {
    const defaultAddr = cust.addresses && cust.addresses.find((a) => a.coordinates && a.coordinates.length === 2);
    if (defaultAddr && isPointInServiceArea(defaultAddr.coordinates, activeArea.boundary)) {
      cust.serviceAreaId = activeArea._id;
      await cust.save();
      updatedCustomers++;
    }
  }

  console.log('Migration summary:');
  console.log(`  Riders updated:           ${updatedRiders}`);
  console.log(`  Washers updated:          ${updatedWashers}`);
  console.log(`  ServiceProviders updated: ${updatedSPs}`);
  console.log(`  Orders updated:           ${updatedOrders}`);
  console.log(`  Customers updated:        ${updatedCustomers}`);
  console.log('--- Migration Finished Successfully ---');
  await mongoose.disconnect();
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate };
