// scripts/createAdmin.js
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // Fix DNS for Atlas
require('dotenv').config();
const bcrypt = require('bcrypt');
const connectDB = require('../config/db');
const Account = require('../models/Account');
const Admin = require('../models/Admin');
const { ALL_PERMISSIONS } = require('../constants/permissions');

// ========== EDIT THESE CREDENTIALS ==========
const ADMIN_EMAIL = 'nikhil19ec034@satiengg.in';
const ADMIN_MOBILE = '9893156336';
const ADMIN_PASSWORD = 'admin@123';
const ADMIN_NAME = 'Super Admin';
// ============================================

async function createAdmin() {
  try {
    await connectDB();

    let account = await Account.findOne({ email: ADMIN_EMAIL });

    if (!account) {
      const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
      account = await Account.create({
        email: ADMIN_EMAIL,
        mobile: ADMIN_MOBILE,
        password: hashedPassword,
        role: 'admin',
        isVerified: true,
      });
      console.log('✅ Admin account created.');
    } else {
      console.log(`⚠️ Admin with email ${ADMIN_EMAIL} already exists — checking Admin profile.`);
    }

    // This is the super admin — always gets every permission, and
    // `superAdminOnly`/`requirePermission` treat level:'admin' as
    // unrestricted regardless of what's listed here.
    const existingProfile = await Admin.findOne({ accountId: account._id });
    if (!existingProfile) {
      await Admin.create({
        accountId: account._id,
        fullName: ADMIN_NAME,
        level: 'admin',
        permissions: ALL_PERMISSIONS,
        isActive: true,
      });
      console.log('✅ Super admin profile created.');
    } else {
      console.log('ℹ️ Admin profile already exists — nothing to do.');
    }

    console.log(`   Email: ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    console.log(`   Role: admin (super admin)`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error creating admin:', err);
    process.exit(1);
  }
}

createAdmin();