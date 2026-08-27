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
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
      return res.status(401).json({ success: false, message: "No token" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Role ke hisaab se user fetch karo
    if (decoded.role === "washer") {
      req.user = await Washer.findById(decoded.id).select("-password");
    } else {
      req.user = await Customer.findById(decoded.id).select("-password");
    }

    if (!req.user)
      return res.status(401).json({ success: false, message: "User not found" });

    next();
  } catch (err) {
    res.status(401).json({ success: false, message: "Invalid token" });
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

    // riderId token mein hai
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

// ── Admin / sub-admin authorization ─────────────────────────────
// Run AFTER `protect`. Loads the models/Admin.js profile for the
// authenticated Account (role 'admin' or 'subadmin') and attaches it as
// req.admin, so downstream handlers/middleware can check level/permissions
// without hitting the DB themselves.
const loadAdminProfile = async (req, res, next) => {
  try {
    if (!req.user || !['admin', 'subadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden — admin access only' });
    }

    let adminProfile = await Admin.findOne({ accountId: req.user.id });

    // Self-heal: an 'admin' Account created before this Admin-profile
    // system existed (e.g. via scripts/createAdmin.js) won't have a
    // matching Admin doc yet. Rather than lock the super admin out,
    // materialize their profile on first authenticated request. This
    // never applies to 'subadmin' accounts — those are only ever created
    // through POST /api/admin/subadmins, which always creates the profile
    // in the same step.
    if (!adminProfile && req.user.role === 'admin') {
      adminProfile = await Admin.create({
        accountId: req.user.id,
        fullName: 'Super Admin',
        level: 'admin',
        permissions: ALL_PERMISSIONS,
        isActive: true,
      });
    }

    if (!adminProfile) {
      return res.status(403).json({ error: 'Admin profile not found' });
    }
    if (!adminProfile.isActive) {
      return res.status(403).json({ error: 'This admin account has been deactivated' });
    }

    req.admin = adminProfile;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Gate for actions that are NEVER delegable to a sub-admin, no matter what
// permissions they've been granted: deleting riders/washers/customers, and
// creating/editing/removing sub-admins. Must run after loadAdminProfile.
const superAdminOnly = (req, res, next) => {
  if (!req.admin || req.admin.level !== 'admin') {
    return res.status(403).json({ error: 'Only the super admin can perform this action' });
  }
  next();
};

// Permission gate for ordinary admin actions. The super admin (level
// 'admin') always passes, regardless of the `permissions` array. A
// sub-admin must have every permission listed. Must run after
// loadAdminProfile.
const requirePermission = (...perms) => {
  return (req, res, next) => {
    if (!req.admin) return res.status(403).json({ error: 'Forbidden' });
    if (req.admin.level === 'admin') return next();

    const missing = perms.filter((p) => !req.admin.permissions.includes(p));
    if (missing.length > 0) {
      return res.status(403).json({
        error: `Missing permission(s): ${missing.join(', ')}`,
      });
    }
    next();
  };
};

// Guards POST /api/admin/bootstrap/enable and /disable. Two ways in:
//  1. Developer, via a shared secret set in .env (ADMIN_BOOTSTRAP_SECRET),
//     sent as the `x-bootstrap-secret` header. This is the ONLY way in
//     when no working super-admin account exists yet (disaster recovery),
//     which is exactly the scenario this toggle exists for.
//  2. An already-authenticated super admin, via the normal JWT flow.
// Either is enough — this is deliberately an OR, not an AND.
const requireBootstrapSecretOrSuperAdmin = (req, res, next) => {
  const secret = req.headers['x-bootstrap-secret'];
  if (secret && process.env.ADMIN_BOOTSTRAP_SECRET && secret === process.env.ADMIN_BOOTSTRAP_SECRET) {
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
};