const mongoose = require('mongoose');
const { ALL_PERMISSIONS } = require('../constants/permissions');

/**
 * One Admin document per Account whose role is 'admin', 'subadmin', or 'regional_manager'.
 * Account already handles login (email + password, JWT). This model
 * is the admin-specific profile layered on top of it.
 */
const AdminSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      unique: true,
    },
    fullName: { type: String, required: true, trim: true },

    // 'admin'            = super admin, full unrestricted access.
    // 'subadmin'         = restricted to `permissions`.
    // 'regional_manager' = restricted to `permissions` AND `serviceAreaIds`.
    level: {
      type: String,
      enum: ['admin', 'subadmin', 'regional_manager'],
      required: true,
    },

    permissions: {
      type: [{ type: String, enum: ALL_PERMISSIONS }],
      default: [],
    },

    // Service areas this manager is authorized to access.
    // Null/empty = no area access. Only enforced for non-admin levels.
    serviceAreaIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ServiceArea',
      },
    ],

    // Super admin's Account._id that created this account. Null for the
    // super admin themselves.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Admin', AdminSchema);