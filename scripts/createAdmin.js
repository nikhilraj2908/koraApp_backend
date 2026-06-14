// scripts/createAdmin.js
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // Fix DNS for Atlas
require('dotenv').config();
const bcrypt = require('bcrypt');
const connectDB = require('../config/db');
const Account = require('../models/Account');

// ========== EDIT THESE CREDENTIALS ==========
const ADMIN_EMAIL = 'nikhil19ec034@satiengg.in';
const ADMIN_MOBILE = '9893156336';
const ADMIN_PASSWORD = 'admin@123';
// ============================================

async function createAdmin() {
  try {
    await connectDB();

    const existing = await Account.findOne({ email: ADMIN_EMAIL });
    if (existing) {
      console.log(`⚠️ Admin with email ${ADMIN_EMAIL} already exists.`);
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const admin = new Account({
      email: ADMIN_EMAIL,
      mobile: ADMIN_MOBILE,
      password: hashedPassword,
      role: 'admin',
      isVerified: true,
    });
    await admin.save();

    console.log('✅ Admin user created successfully!');
    console.log(`   Email: ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    console.log(`   Role: admin`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error creating admin:', err);
    process.exit(1);
  }
}

createAdmin();