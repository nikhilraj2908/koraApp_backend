/**
 * controllers/userManagementController.js
 *
 * Admin user management: create / list / view / update / activate / deactivate
 * sub-admins and regional managers. Handles service-area assignments,
 * permission assignments, password reset, and last-login reporting.
 *
 * ALL routes here are super-admin-only.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Account = require('../models/Account');
const Admin = require('../models/Admin');
const ServiceArea = require('../models/ServiceArea');
const { ALL_PERMISSIONS } = require('../constants/permissions');

const ok = (res, data, code = 200) => res.status(code).json({ success: true, data });
const fail = (res, message, code = 500) => res.status(code).json({ success: false, message });

const MANAGER_ROLES = ['subadmin', 'regional_manager'];
const normalizeMobile = (mobile) => String(mobile || '').replace(/\D/g, '').slice(-10);

/** Generate a random temporary password */
function generateTempPassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** Sanitize an Admin+Account document for API responses (no passwords). */
function sanitizeUser(adminDoc, accountDoc) {
  return {
    id: adminDoc._id,
    accountId: accountDoc._id,
    fullName: adminDoc.fullName,
    email: accountDoc.email,
    mobile: accountDoc.mobile,
    role: accountDoc.role,
    level: adminDoc.level,
    permissions: adminDoc.permissions,
    serviceAreaIds: adminDoc.serviceAreaIds,
    isActive: adminDoc.isActive,
    mustChangePassword: accountDoc.mustChangePassword,
    lastLoginAt: accountDoc.lastLoginAt,
    createdBy: adminDoc.createdBy,
    createdAt: adminDoc.createdAt,
    updatedAt: adminDoc.updatedAt,
  };
}

/**
 * GET /api/admin/users
 * List all sub-admins and regional managers.
 */
exports.listUsers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const { role, isActive } = req.query;

    const levelFilter = {};
    if (role === 'subadmin') levelFilter.level = 'subadmin';
    else if (role === 'regional_manager') levelFilter.level = 'regional_manager';
    else levelFilter.level = { $in: ['subadmin', 'regional_manager'] };

    if (isActive !== undefined) levelFilter.isActive = isActive === 'true';

    const [admins, total] = await Promise.all([
      Admin.find(levelFilter)
        .populate({ path: 'accountId', select: 'email mobile role mustChangePassword lastLoginAt createdAt' })
        .populate({ path: 'serviceAreaIds', select: 'name status' })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Admin.countDocuments(levelFilter),
    ]);

    const users = admins
      .filter((a) => a.accountId) // guard against orphaned Admin docs
      .map((a) => sanitizeUser(a, a.accountId));

    ok(res, { users, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    fail(res, err.message);
  }
};

/**
 * POST /api/admin/users
 * Create a sub-admin or regional manager with a temporary password.
 *
 * Body: { fullName, email, mobile?, role: 'subadmin'|'regional_manager',
 *         permissions?, serviceAreaIds?, tempPassword? }
 *
 * Returns the plaintext tempPassword ONCE — never again.
 */
exports.createUser = async (req, res) => {
  let account;
  try {
    const {
      fullName,
      email,
      mobile,
      role,
      permissions = [],
      serviceAreaIds = [],
      tempPassword,
    } = req.body;

    if (!fullName || !email || !role) {
      return fail(res, 'fullName, email, and role are required', 400);
    }
    if (!MANAGER_ROLES.includes(role)) {
      return fail(res, `role must be one of: ${MANAGER_ROLES.join(', ')}`, 400);
    }

    // Validate permissions
    const invalidPerms = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
    if (invalidPerms.length > 0) {
      return fail(res, `Unknown permission(s): ${invalidPerms.join(', ')}`, 400);
    }

    // Validate service areas exist
    if (serviceAreaIds.length > 0) {
      const found = await ServiceArea.countDocuments({ _id: { $in: serviceAreaIds } });
      if (found !== serviceAreaIds.length) {
        return fail(res, 'One or more serviceAreaIds are invalid', 400);
      }
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes('@')) {
      return fail(res, 'A valid email is required', 400);
    }

    if (await Account.findOne({ email: normalizedEmail })) {
      return fail(res, 'Email already registered', 409);
    }

    const normalizedMobile = mobile ? normalizeMobile(mobile) : null;
    if (normalizedMobile) {
      if (normalizedMobile.length !== 10) {
        return fail(res, 'A valid 10-digit mobile number is required', 400);
      }
      if (await Account.findOne({ mobile: normalizedMobile })) {
        return fail(res, 'Mobile already registered', 409);
      }
    }

    const plainPassword = tempPassword || generateTempPassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const accountData = {
      email: normalizedEmail,
      password: hashedPassword,
      role,
      isVerified: true, // admin-created accounts skip OTP
      mustChangePassword: true, // must change on first login
    };
    if (normalizedMobile) accountData.mobile = normalizedMobile;

    account = await Account.create(accountData);

    const adminProfile = await Admin.create({
      accountId: account._id,
      fullName: fullName.trim(),
      level: role === 'subadmin' ? 'subadmin' : 'regional_manager',
      permissions,
      serviceAreaIds,
      createdBy: req.user.id,
      isActive: true,
    });

    ok(
      res,
      {
        ...sanitizeUser(adminProfile, account),
        // Return plaintext temp password ONLY in this response.
        temporaryPassword: plainPassword,
        notice: 'Share this temporary password with the user. It will not be shown again.',
      },
      201
    );
  } catch (err) {
    // Rollback if Admin.create failed after Account.create
    if (account?._id) {
      await Account.deleteOne({ _id: account._id }).catch(() => {});
    }
    fail(res, err.message, err.statusCode || 500);
  }
};

/**
 * GET /api/admin/users/:id
 */
exports.getUser = async (req, res) => {
  try {
    const adminDoc = await Admin.findOne({
      _id: req.params.id,
      level: { $in: ['subadmin', 'regional_manager'] },
    })
      .populate({ path: 'accountId', select: 'email mobile role mustChangePassword lastLoginAt createdAt' })
      .populate({ path: 'serviceAreaIds', select: 'name status' });

    if (!adminDoc || !adminDoc.accountId) return fail(res, 'User not found', 404);

    ok(res, sanitizeUser(adminDoc, adminDoc.accountId));
  } catch (err) {
    fail(res, err.message);
  }
};

/**
 * PATCH /api/admin/users/:id
 * Update name.
 */
exports.updateUser = async (req, res) => {
  try {
    const { fullName } = req.body;
    if (!fullName) return fail(res, 'fullName is required', 400);

    const adminDoc = await Admin.findOne({
      _id: req.params.id,
      level: { $in: ['subadmin', 'regional_manager'] },
    }).populate({ path: 'accountId', select: 'email mobile role mustChangePassword lastLoginAt createdAt' });
    if (!adminDoc) return fail(res, 'User not found', 404);

    adminDoc.fullName = fullName.trim();
    await adminDoc.save();

    ok(res, sanitizeUser(adminDoc, adminDoc.accountId));
  } catch (err) {
    fail(res, err.message);
  }
};

/**
 * PATCH /api/admin/users/:id/service-areas
 * Replace the set of assigned service areas.
 * Body: { serviceAreaIds: [...] }
 */
exports.updateServiceAreas = async (req, res) => {
  try {
    const { serviceAreaIds = [] } = req.body;
    if (!Array.isArray(serviceAreaIds)) {
      return fail(res, 'serviceAreaIds must be an array', 400);
    }

    // Validate all provided IDs exist
    if (serviceAreaIds.length > 0) {
      const found = await ServiceArea.countDocuments({ _id: { $in: serviceAreaIds } });
      if (found !== serviceAreaIds.length) {
        return fail(res, 'One or more serviceAreaIds are invalid', 400);
      }
    }

    const adminDoc = await Admin.findOne({
      _id: req.params.id,
      level: { $in: ['subadmin', 'regional_manager'] },
    }).populate({ path: 'accountId', select: 'email mobile role mustChangePassword lastLoginAt createdAt' });
    if (!adminDoc) return fail(res, 'User not found', 404);

    adminDoc.serviceAreaIds = serviceAreaIds;
    await adminDoc.save();

    ok(res, sanitizeUser(adminDoc, adminDoc.accountId));
  } catch (err) {
    fail(res, err.message);
  }
};

/**
 * PATCH /api/admin/users/:id/permissions
 * Replace the set of granted permissions.
 * Body: { permissions: [...] }
 */
exports.updatePermissions = async (req, res) => {
  try {
    const { permissions } = req.body;
    if (!Array.isArray(permissions)) {
      return fail(res, 'permissions must be an array', 400);
    }

    const invalidPerms = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
    if (invalidPerms.length > 0) {
      return fail(res, `Unknown permission(s): ${invalidPerms.join(', ')}`, 400);
    }

    const adminDoc = await Admin.findOne({
      _id: req.params.id,
      level: { $in: ['subadmin', 'regional_manager'] },
    }).populate({ path: 'accountId', select: 'email mobile role mustChangePassword lastLoginAt createdAt' });
    if (!adminDoc) return fail(res, 'User not found', 404);

    adminDoc.permissions = permissions;
    await adminDoc.save();

    ok(res, sanitizeUser(adminDoc, adminDoc.accountId));
  } catch (err) {
    fail(res, err.message);
  }
};

/**
 * PATCH /api/admin/users/:id/status
 * Activate or deactivate a manager account.
 * Body: { isActive: boolean }
 */
exports.updateStatus = async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return fail(res, 'isActive must be a boolean', 400);
    }

    const adminDoc = await Admin.findOne({
      _id: req.params.id,
      level: { $in: ['subadmin', 'regional_manager'] },
    }).populate({ path: 'accountId', select: 'email mobile role mustChangePassword lastLoginAt createdAt' });
    if (!adminDoc) return fail(res, 'User not found', 404);

    // Prevent deactivation of the caller themselves
    if (adminDoc.accountId._id.toString() === req.user.id.toString()) {
      return fail(res, 'You cannot deactivate your own account', 400);
    }

    adminDoc.isActive = isActive;
    await adminDoc.save();

    ok(res, sanitizeUser(adminDoc, adminDoc.accountId));
  } catch (err) {
    fail(res, err.message);
  }
};

/**
 * POST /api/admin/users/:id/reset-password
 * Admin resets a manager's password.
 * Returns the new temp password ONCE. Sets mustChangePassword = true.
 */
exports.resetPassword = async (req, res) => {
  try {
    const adminDoc = await Admin.findOne({
      _id: req.params.id,
      level: { $in: ['subadmin', 'regional_manager'] },
    });
    if (!adminDoc) return fail(res, 'User not found', 404);

    const account = await Account.findById(adminDoc.accountId);
    if (!account) return fail(res, 'Account not found', 404);

    const newTempPassword = generateTempPassword();
    account.password = await bcrypt.hash(newTempPassword, 10);
    account.mustChangePassword = true;
    await account.save();

    ok(res, {
      message: 'Password reset. Share this temporary password with the user.',
      temporaryPassword: newTempPassword,
      notice: 'This password will not be shown again.',
    });
  } catch (err) {
    fail(res, err.message);
  }
};
