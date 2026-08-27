const mongoose = require('mongoose');
const { ALL_PERMISSIONS } = require('../constants/permissions');

/**
 * One Admin document per Account whose role is 'admin' or 'subadmin'.
 * Account already handles login (email/mobile + password, JWT). This model
 * is the admin-specific profile layered on top of it: who they are, whether
 * they're the super admin or a sub-admin, and — for sub-admins — exactly
 * which permissions the super admin has granted them.
 */
const AdminSchema = new mongoose.Schema({
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
    unique: true,
  },
  fullName: { type: String, required: true, trim: true },

  // 'admin'    = super admin, full unrestricted access, ignores `permissions`.
  // 'subadmin' = restricted to `permissions` (and can never do
  //              super-admin-only actions regardless of what's granted).
  level: {
    type: String,
    enum: ['admin', 'subadmin'],
    required: true,
  },

  permissions: {
    type: [{ type: String, enum: ALL_PERMISSIONS }],
    default: [],
  },

  // Super admin's Account._id that created this sub-admin. Null for the
  // super admin themselves.
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    default: null,
  },

  // Lets a super admin temporarily disable a sub-admin's access without
  // deleting their account outright.
  isActive: { type: Boolean, default: true },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Admin', AdminSchema);