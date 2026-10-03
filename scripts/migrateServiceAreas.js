/**
 * scripts/migrateServiceAreas.js
 *
 * Migration script to backfill `serviceAreaId` on existing Riders, Washers,
 * Customers, and Orders based strictly on geospatial coordinates
 * falling within active service area boundaries.
 *
 * Supports MULTIPLE active service areas simultaneously.
 * Customers are backfilled from their most recent order's serviceAreaId.
 *
 * Usage:
 *   node scripts/migrateServiceAreas.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const ServiceArea = require('../models/ServiceArea');
const Rider = require('../models/Rider');
const Washer = require('../models/Washer');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const { isPointInServiceArea } = require('../utils/geoJsonValidator');

/**
 * Finds which active service area (if any) a [lng, lat] coordinate belongs to.
 */
function resolveArea(coordinates, activeAreas) {
  if (!coordinates || coordinates.length < 2) return null;
  for (const area of activeAreas) {
    if (area.boundary && isPointInServiceArea(coordinates, area.boundary)) {
      return area;
    }
  }
  return null;
}

async function migrate() {
  console.log('--- Starting Service Area Migration (Multi-Area) ---');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB.');

  const activeAreas = await ServiceArea.find({ status: 'active' });
  if (!activeAreas || activeAreas.length === 0) {
    console.log('No active service areas found. Activate at least one first.');
    process.exit(0);
  }

  console.log(`Found ${activeAreas.length} active service area(s):`);
  activeAreas.forEach((a) => console.log(`   - "${a.name}" (${a._id})`));

  let updatedRiders = 0;
  let updatedWashers = 0;
  let updatedOrders = 0;
  let updatedCustomers = 0;
  let skipped = 0;

  // ── 1. Backfill Riders ──────────────────────────────────────────────────
  console.log('\n[1/4] Backfilling Riders...');
  const riders = await Rider.find({ serviceAreaId: null });
  console.log(`  Found ${riders.length} riders without serviceAreaId.`);
  for (const rider of riders) {
    const coords =
      rider.baseLocation?.coordinates?.length === 2
        ? rider.baseLocation.coordinates
        : rider.currentLocation?.coordinates?.length === 2
        ? rider.currentLocation.coordinates
        : null;

    const matched = resolveArea(coords, activeAreas);
    if (matched) {
      rider.serviceAreaId = matched._id;
      await rider.save();
      updatedRiders++;
      console.log(`  Rider "${rider.fullName}" -> "${matched.name}"`);
    } else {
      skipped++;
      console.log(`  SKIP Rider "${rider.fullName}" - no GPS or outside all areas`);
    }
  }

  // ── 2. Backfill Washers ─────────────────────────────────────────────────
  console.log('\n[2/4] Backfilling Washers...');
  const washers = await Washer.find({ serviceAreaId: null });
  console.log(`  Found ${washers.length} washers without serviceAreaId.`);
  for (const washer of washers) {
    const coords = washer.shopLocation?.coordinates?.length === 2
      ? washer.shopLocation.coordinates
      : null;

    const matched = resolveArea(coords, activeAreas);
    if (matched) {
      washer.serviceAreaId = matched._id;
      await washer.save();
      updatedWashers++;
      console.log(`  Washer "${washer.name}" -> "${matched.name}"`);
    } else {
      skipped++;
      console.log(`  SKIP Washer "${washer.name}" - no shopLocation GPS or outside all areas`);
    }
  }

  // ── 3. Backfill Orders ──────────────────────────────────────────────────
  console.log('\n[3/4] Backfilling Orders...');
  const orders = await Order.find({ serviceAreaId: null });
  console.log(`  Found ${orders.length} orders without serviceAreaId.`);
  for (const order of orders) {
    const coords = order.pickupLocation?.coordinates?.length === 2
      ? order.pickupLocation.coordinates
      : null;

    const matched = resolveArea(coords, activeAreas);
    if (matched) {
      order.serviceAreaId = matched._id;
      await order.save();
      updatedOrders++;
    } else {
      skipped++;
    }
  }
  console.log(`  Updated ${updatedOrders} orders.`);

  // ── 4. Backfill Customers (from order history) ──────────────────────────
  // Find each customer's most recent order that has a serviceAreaId resolved.
  console.log('\n[4/4] Backfilling Customers from order history...');
  const customers = await Customer.find({
    $or: [
      { lastKnownServiceAreaId: null },
      { lastKnownServiceAreaId: { $exists: false } },
    ],
  });
  console.log(`  Found ${customers.length} customers without lastKnownServiceAreaId.`);
  for (const cust of customers) {
    const recentOrder = await Order.findOne({
      customerId: cust._id,
      serviceAreaId: { $ne: null, $exists: true },
    }).sort({ createdAt: -1 });

    if (recentOrder && recentOrder.serviceAreaId) {
      cust.lastKnownServiceAreaId = recentOrder.serviceAreaId;
      cust.lastLocationVerifiedAt = recentOrder.createdAt || new Date();
      await cust.save();
      updatedCustomers++;
      console.log(`  Customer "${cust.name || cust._id}" -> service area from order history`);
    } else {
      // Fallback: check saved addresses for GPS
      const addrWithCoords = cust.addresses?.find((a) => a.coordinates?.length === 2);
      if (addrWithCoords) {
        const matched = resolveArea(addrWithCoords.coordinates, activeAreas);
        if (matched) {
          cust.lastKnownServiceAreaId = matched._id;
          cust.lastLocationVerifiedAt = new Date();
          await cust.save();
          updatedCustomers++;
          console.log(`  Customer "${cust.name || cust._id}" -> "${matched.name}" (from address)`);
        } else {
          skipped++;
        }
      } else {
        skipped++;
        console.log(`  SKIP Customer "${cust.name || cust._id}" - no resolvable location`);
      }
    }
  }

  console.log('\n=== Migration Summary ===');
  console.log(`  Riders updated:    ${updatedRiders}`);
  console.log(`  Washers updated:   ${updatedWashers}`);
  console.log(`  Orders updated:    ${updatedOrders}`);
  console.log(`  Customers updated: ${updatedCustomers}`);
  console.log(`  Skipped:           ${skipped}`);
  console.log('--- Migration Finished ---');
  await mongoose.disconnect();
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate };

