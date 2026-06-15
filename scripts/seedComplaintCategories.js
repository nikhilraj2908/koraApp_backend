const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // Fix DNS for Atlas
require('dotenv').config();
const connectDB = require('../config/db');
const ComplaintCategory = require('../models/ComplaintCategory');

const categories = [
  {
    name: 'Order Issue',
    subCategories: [
      'Damaged Item',
      'Missing Item',
      'Wrong Item Received',
      'Incomplete Order',
      'Expired Product',
      'Poor Packaging'
    ],
    displayOrder: 1,
    isActive: true,
  },
  {
    name: 'Delivery Delay',
    subCategories: [
      'Delayed Beyond Promised Time',
      'No Update on Tracking',
      'Rider Never Arrived',
      'Delivered to Wrong Address',
      'Extreme Late (24h+)'
    ],
    displayOrder: 2,
    isActive: true,
  },
  {
    name: 'Payment Problem',
    subCategories: [
      'Duplicate Charge',
      'Refund Not Processed',
      'Payment Deducted but Order Not Placed',
      'Wrong Amount Charged',
      'Promo Code Not Applied'
    ],
    displayOrder: 3,
    isActive: true,
  },
  {
    name: 'Staff Behaviour',
    subCategories: [
      'Rude Driver/Rider',
      'Unprofessional Customer Support',
      'Ignored Special Instructions',
      'Harassment or Misconduct'
    ],
    displayOrder: 4,
    isActive: true,
  },
  {
    name: 'App / Technical',
    subCategories: [
      'App Crashes',
      'Login Issues',
      'Payment Gateway Error',
      'GPS/Location Not Working',
      'Push Notifications Not Received'
    ],
    displayOrder: 5,
    isActive: true,
  },
  {
    name: 'Other',
    subCategories: [
      'General Feedback',
      'Suggestion',
      'Uncategorized Complaint'
    ],
    displayOrder: 6,
    isActive: true,
  },
];

async function seed() {
  try {
    await connectDB();
    // Clear existing complaint categories
    await ComplaintCategory.deleteMany();
    console.log('🗑️  Cleared old complaint categories');
    // Insert new ones
    const inserted = await ComplaintCategory.insertMany(categories);
    console.log(`✅ Seeded ${inserted.length} complaint categories with subcategories`);
    // Log each for verification
    inserted.forEach(cat => {
      console.log(`   - ${cat.name} : ${cat.subCategories.length} subcategories`);
    });
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

seed();