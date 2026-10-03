const Washer = require('../models/Washer');
const Customer = require('../models/Customer');
const jwt = require('jsonwebtoken');
const Rider = require('../models/Rider');
const Admin = require('../models/Admin');
const { ALL_PERMISSIONS } = require('../constants/permissions');

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ error: 'Not authorized' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const washerprotect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token)
      return res.status(401).json({ success: false, message: 'No token' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role === 'washer') {
      req.user = await Washer.findById(decoded.id).select('-password');
    } else {
      req.user = await Customer.findById(decoded.id).select('-password');
    }

    if (!req.user)
      return res.status(401).json({ success: false, message: 'User not found' });

    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// ── Rider protect ────────────────────────────────────────────
const riderProtect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'rider') {
      return res.status(401).json({ message: 'Not a rider token' });
    }

    const rider = await Rider.findById(decoded.riderId);
    if (!rider) return res.status(401).json({ message: 'Rider not found' });

    req.rider = rider;
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
};

// ── Admin / sub-admin / regional_manager authorization ──────────────────────
// Run AFTER `protect`. Loads the Admin profile for the authenticated Account
// and attaches it as req.admin, so downstream middleware can check
// level/permissions/serviceAreaIds without hitting the DB themselves.
const loadAdminProfile = async (req, res, next) => {
  try {
    const ADMIN_ROLES = ['admin', 'subadmin', 'regional_manager'];
    if (!req.user || !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden — admin access only' });
    }

    // Re-fetch from DB on every request to guarantee we use current
    // permissions/serviceAreaIds, not stale JWT claims.
    let adminProfile = await Admin.findOne({ accountId: req.user.id });

    // Self-heal: an 'admin' Account created before this Admin-profile
    // system existed won't have a matching Admin doc yet.
    if (!adminProfile && req.user.role === 'admin') {
      adminProfile = await Admin.create({
        accountId: req.user.id,
        fullName: 'Super Admin',
        level: 'admin',
        permissions: ALL_PERMISSIONS,
        serviceAreaIds: [],
        isActive: true,
      });
    }

    if (!adminProfile) {
      return res.status(403).json({ error: 'Admin profile not found' });
    }
    if (!adminProfile.isActive) {
      return res.status(403).json({
        error: 'ACCOUNT_INACTIVE',
        message: 'This account has been deactivated',
      });
    }

    // Enforce mustChangePassword: managers must change their password before
    // accessing any dashboard API. Re-read from Account to get fresh state.
    const Account = require('../models/Account');
    const accountDoc = await Account.findById(req.user.id).select('mustChangePassword');
    if (accountDoc?.mustChangePassword) {
      // Only allow the change-password endpoint through.
      const isChangePasswordRoute =
        req.path === '/change-password' ||
        req.originalUrl.includes('/change-password');
      if (!isChangePasswordRoute) {
        return res.status(403).json({
          error: 'MUST_CHANGE_PASSWORD',
          message: 'You must change your temporary password before continuing.',
        });
      }
    }

    req.admin = adminProfile;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Gate for actions that are NEVER delegable (deleting riders/washers/customers,
// creating/editing/removing managers). Must run after loadAdminProfile.
const superAdminOnly = (req, res, next) => {
  if (!req.admin || req.admin.level !== 'admin') {
    return res.status(403).json({ error: 'Only the super admin can perform this action' });
  }
  next();
};

// Permission gate for ordinary admin actions. The super admin (level === 'admin')
// always passes. Sub-admin and regional_manager must have every listed permission.
// Must run after loadAdminProfile.
const requirePermission = (...perms) => {
  return (req, res, next) => {
    if (!req.admin) return res.status(403).json({ error: 'Forbidden' });
    if (req.admin.level === 'admin') return next();

    const missing = perms.filter((p) => !req.admin.permissions.includes(p));
    if (missing.length > 0) {
      return res.status(403).json({
        error: 'PERMISSION_DENIED',
        message: `Missing permission(s): ${missing.join(', ')}`,
      });
    }
    next();
  };
};

/**
 * Service-area scoping helper — call AFTER loadAdminProfile.
 *
 * Returns the set of serviceAreaIds this user is authorized to access:
 *   - Super admin  → null (means "no restriction, see everything")
 *   - Sub-admin / Regional Manager → their assigned serviceAreaIds array
 *     (may be empty if none have been assigned yet)
 *
 * Attach this result to req.scopedServiceAreaIds so list/detail handlers
 * can apply a DB-level filter.
 */
const scopeServiceAreas = (req, res, next) => {
  if (!req.admin) return res.status(403).json({ error: 'Forbidden' });

  if (req.admin.level === 'admin') {
    req.scopedServiceAreaIds = null; // null = unrestricted
  } else {
    // Always use the DB-loaded value from req.admin (never from JWT).
    req.scopedServiceAreaIds = (req.admin.serviceAreaIds || []).map((id) =>
      id.toString()
    );
  }
  next();
};

/**
 * Object-level service-area check.
 * Call with the serviceAreaId of the resource being accessed.
 * Returns true if the caller can access it, false otherwise.
 */
const canAccessServiceArea = (req, resourceServiceAreaId) => {
  if (!req.admin) return false;
  if (req.admin.level === 'admin') return true; // super admin: unrestricted
  if (!resourceServiceAreaId) return false;
  return (req.admin.serviceAreaIds || [])
    .map((id) => id.toString())
    .includes(resourceServiceAreaId.toString());
};

// Guards POST /api/admin/bootstrap/enable and /disable.
const requireBootstrapSecretOrSuperAdmin = (req, res, next) => {
  const secret = req.headers['x-bootstrap-secret'];
  if (
    secret &&
    process.env.ADMIN_BOOTSTRAP_SECRET &&
    secret === process.env.ADMIN_BOOTSTRAP_SECRET
  ) {
    return next();
  }

  protect(req, res, () => {
    restrictTo('admin')(req, res, () => {
      loadAdminProfile(req, res, () => {
        superAdminOnly(req, res, next);
      });
    });
  });
};

module.exports = {
  protect,
  restrictTo,
  washerprotect,
  riderProtect,
  loadAdminProfile,
  superAdminOnly,
  requirePermission,
  requireBootstrapSecretOrSuperAdmin,
  scopeServiceAreas,
  canAccessServiceArea,
};