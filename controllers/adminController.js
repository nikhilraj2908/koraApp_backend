const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Account = require('../models/Account');
const Admin = require('../models/Admin');
const AdminBootstrap = require('../models/AdminBootstrap');
const Customer = require('../models/Customer');
const Rider = require('../models/Rider');
const Washer = require('../models/Washer');
const Order = require('../models/Order');
const Complaint = require('../models/Complaint');
const { ALL_PERMISSIONS } = require('../constants/permissions');
const { emitOrderUpdate } = require('../socket/trackingSocket');

const ok = (res, data, code = 200) => res.status(code).json({ success: true, data });
const fail = (res, message, code = 500) => res.status(code).json({ success: false, message });

const resolveOrderQuery = (rawId) => {
  const isObjectId = mongoose.Types.ObjectId.isValid(rawId);
  return isObjectId
    ? { $or: [{ _id: rawId }, { orderNumber: rawId }] }
    : { orderNumber: rawId };
};

const normalizeMobile = (mobile) => String(mobile || '').replace(/\D/g, '').slice(-10);

// Rider/washer documents are stored in the DB as relative paths
// (e.g. "/uploads/xyz.jpg") because that's what the mobile apps expect.
// The admin dashboard is a separate consumer that needs a directly
// renderable <img src>, so we turn them into absolute URLs only in the
// admin API responses, without touching what's actually stored in Mongo.
const absolutize = (req, relPath) => {
  if (!relPath) return relPath;
  if (/^https?:\/\//i.test(relPath)) return relPath; // already absolute
  const base = `${req.protocol}://${req.get('host')}`;
  return relPath.startsWith('/') ? `${base}${relPath}` : `${base}/${relPath}`;
};

// Rider.documents = { aadhaarFront, aadhaarBack, drivingLicense, rc, profilePhoto }
const absolutizeRider = (req, riderDoc) => {
  const rider = riderDoc.toObject ? riderDoc.toObject() : riderDoc;
  if (rider.documents) {
    for (const key of Object.keys(rider.documents)) {
      rider.documents[key] = absolutize(req, rider.documents[key]);
    }
  }
  return rider;
};

// Washer has top-level image fields, not a nested `documents` object.
const absolutizeWasher = (req, washerDoc) => {
  const washer = washerDoc.toObject ? washerDoc.toObject() : washerDoc;
  for (const key of ['shopPhoto', 'aadhaarFront', 'aadhaarBack', 'profilePhoto']) {
    if (washer[key]) washer[key] = absolutize(req, washer[key]);
  }
  return washer;
};

// Order.clothPhotos = { wash: [...], iron: [...] } — optional, may be absent.
const absolutizeOrder = (req, orderDoc) => {
  const order = orderDoc.toObject ? orderDoc.toObject() : orderDoc;
  if (order.clothPhotos) {
    order.clothPhotos.wash = (order.clothPhotos.wash || []).map((p) => absolutize(req, p));
    order.clothPhotos.iron = (order.clothPhotos.iron || []).map((p) => absolutize(req, p));
  }
  return order;
};

// Enriches populated customerId with phone and email from Account if missing on Customer document
const enrichOrderCustomer = async (orders) => {
  const orderList = Array.isArray(orders) ? orders : [orders];
  const missingAccIds = [];

  for (const o of orderList) {
    const cust = o.customerId;
    if (cust && cust.accountId && (!cust.phone || !cust.email)) {
      missingAccIds.push(cust.accountId);
    }
  }

  if (missingAccIds.length > 0) {
    const accounts = await Account.find(
      { _id: { $in: missingAccIds } },
      'email mobile'
    ).lean();
    const accMap = new Map(accounts.map((a) => [a._id.toString(), a]));

    for (const o of orderList) {
      const cust = o.customerId;
      if (cust && cust.accountId) {
        const acc = accMap.get(cust.accountId.toString());
        if (acc) {
          if (!cust.phone && acc.mobile) {
            cust.phone = acc.mobile;
          }
          if (!cust.email && acc.email) {
            cust.email = acc.email;
          }
        }
      }
    }
  }
};

// Simple pagination helper shared by every list endpoint.
const getPagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

// Singleton bootstrap flag — created enabled on first read so a fresh
// deployment can create its first admin without any manual DB seeding.
const getBootstrapFlag = async () => {
  let flag = await AdminBootstrap.findOne();
  if (!flag) flag = await AdminBootstrap.create({ enabled: true });
  return flag;
};

// Shared by the public bootstrap endpoint and the authenticated
// "super admin creates another admin" endpoint.
const createAdminAccountAndProfile = async ({ fullName, email, mobile, password, createdBy }) => {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedMobile = normalizeMobile(mobile);

  if (await Account.findOne({ email: normalizedEmail })) {
    const err = new Error('Email already registered');
    err.statusCode = 409;
    throw err;
  }
  if (await Account.findOne({ mobile: normalizedMobile })) {
    const err = new Error('Mobile already registered');
    err.statusCode = 409;
    throw err;
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const account = await Account.create({
    email: normalizedEmail,
    mobile: normalizedMobile,
    password: hashedPassword,
    role: 'admin',
    isVerified: true,
  });

  const admin = await Admin.create({
    accountId: account._id,
    fullName: fullName.trim(),
    level: 'admin',
    permissions: ALL_PERMISSIONS, // super admin — full access always
    createdBy: createdBy || null,
    isActive: true,
  });

  return { account, admin };
};

/* =========================================================================
 * ONE-TIME ADMIN BOOTSTRAP
 * No login required — gated by the AdminBootstrap flag instead, which
 * starts enabled and auto-disables itself the moment it's used. Re-enabling
 * it later requires either the developer's ADMIN_BOOTSTRAP_SECRET or an
 * already-authenticated super admin (see requireBootstrapSecretOrSuperAdmin
 * in middleware/auth.js).
 * ========================================================================= */

// POST /api/admin/bootstrap
exports.bootstrapAdmin = async (req, res) => {
  try {
    const secret = req.headers['x-bootstrap-secret'];
    if (!process.env.ADMIN_BOOTSTRAP_SECRET || secret !== process.env.ADMIN_BOOTSTRAP_SECRET) {
      return fail(res, 'Missing or invalid x-bootstrap-secret header', 403);
    }

    const flag = await getBootstrapFlag();
    if (!flag.enabled) {
      return fail(
        res,
        'Admin bootstrap is currently disabled. Re-enable it via PATCH /api/admin/bootstrap/enable first.',
        403
      );
    }

    const { fullName, email, mobile, password } = req.body;
    if (!fullName || !email || !mobile || !password) {
      return fail(res, 'fullName, email, mobile and password are required', 400);
    }

    const { account, admin } = await createAdminAccountAndProfile({ fullName, email, mobile, password });

    flag.enabled = false;
    flag.updatedAt = new Date();
    flag.lastCreatedAdminAccountId = account._id;
    await flag.save();

    ok(
      res,
      {
        id: admin._id,
        accountId: account._id,
        fullName: admin.fullName,
        email: account.email,
        mobile: account.mobile,
        message: 'Super admin created. The bootstrap endpoint is now disabled.',
      },
      201
    );
  } catch (err) {
    fail(res, err.message, err.statusCode || 500);
  }
};

// GET /api/admin/bootstrap/status — lets the developer check the flag
// without guessing (requires the same secret-or-super-admin gate).
exports.getBootstrapStatus = async (req, res) => {
  try {
    const flag = await getBootstrapFlag();
    ok(res, { enabled: flag.enabled, updatedAt: flag.updatedAt });
  } catch (err) {
    fail(res, err.message);
  }
};

// PATCH /api/admin/bootstrap/enable
exports.enableAdminBootstrap = async (req, res) => {
  try {
    const flag = await getBootstrapFlag();
    flag.enabled = true;
    flag.updatedAt = new Date();
    flag.lastEnabledBy = req.user ? String(req.user.id) : 'developer-secret';
    await flag.save();
    ok(res, { enabled: true });
  } catch (err) {
    fail(res, err.message);
  }
};

// PATCH /api/admin/bootstrap/disable
exports.disableAdminBootstrap = async (req, res) => {
  try {
    const flag = await getBootstrapFlag();
    flag.enabled = false;
    flag.updatedAt = new Date();
    await flag.save();
    ok(res, { enabled: false });
  } catch (err) {
    fail(res, err.message);
  }
};

/* =========================================================================
 * FULL ADMINS — an existing super admin can create another one directly
 * (separate from the one-time bootstrap flow above, and separate from
 * sub-admins: this creates another unrestricted super admin).
 * ========================================================================= */

// POST /api/admin/admins — super admin only
exports.createAdmin = async (req, res) => {
  try {
    const { fullName, email, mobile, password } = req.body;
    if (!fullName || !email || !mobile || !password) {
      return fail(res, 'fullName, email, mobile and password are required', 400);
    }

    const { account, admin } = await createAdminAccountAndProfile({
      fullName,
      email,
      mobile,
      password,
      createdBy: req.user.id,
    });

    ok(
      res,
      {
        id: admin._id,
        accountId: account._id,
        fullName: admin.fullName,
        email: account.email,
        mobile: account.mobile,
      },
      201
    );
  } catch (err) {
    fail(res, err.message, err.statusCode || 500);
  }
};

// GET /api/admin/admins — super admin only
exports.listAdmins = async (req, res) => {
  try {
    const admins = await Admin.find({ level: 'admin' })
      .populate({ path: 'accountId', select: 'email mobile createdAt' })
      .sort({ createdAt: -1 });
    ok(res, admins);
  } catch (err) {
    fail(res, err.message);
  }
};



// GET /api/admin/me — who am I, super admin or sub-admin, what can I do.
exports.getMe = async (req, res) => {
  try {
    ok(res, {
      accountId: req.user.id,
      fullName: req.admin.fullName,
      level: req.admin.level,
      permissions: req.admin.level === 'admin' ? ALL_PERMISSIONS : req.admin.permissions,
      isActive: req.admin.isActive,
    });
  } catch (err) {
    fail(res, err.message);
  }
};

// GET /api/admin/permissions — catalog of assignable permissions, for the
// super admin's "create/edit sub-admin" screen.
exports.listPermissions = async (req, res) => {
  ok(res, { permissions: ALL_PERMISSIONS });
};

/* =========================================================================
 * DASHBOARD — "admin can see all the things the app is working on"
 * ========================================================================= */

// GET /api/admin/dashboard
exports.getDashboardOverview = async (req, res) => {
  try {
    const [
      totalCustomers,
      totalRiders,
      pendingRiders,
      verifiedRiders,
      rejectedRiders,
      totalWashers,
      pendingWashers,
      verifiedWashers,
      rejectedWashers,
      totalOrders,
      ordersByStatusRaw,
      pendingComplaints,
      totalComplaints,
      subAdminCount,
      revenueAgg,
    ] = await Promise.all([
      Customer.countDocuments(),
      Rider.countDocuments(),
      Rider.countDocuments({ verificationStatus: 'pending' }),
      Rider.countDocuments({ verificationStatus: 'verified' }),
      Rider.countDocuments({ verificationStatus: 'rejected' }),
      Washer.countDocuments(),
      Washer.countDocuments({ verificationStatus: 'pending' }),
      Washer.countDocuments({ verificationStatus: 'verified' }),
      Washer.countDocuments({ verificationStatus: 'rejected' }),
      Order.countDocuments(),
      Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Complaint.countDocuments({ status: 'pending' }),
      Complaint.countDocuments(),
      Admin.countDocuments({ level: 'subadmin' }),
      Order.aggregate([
        { $match: { paymentStatus: 'paid' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
    ]);

    const ordersByStatus = ordersByStatusRaw.reduce((acc, cur) => {
      acc[cur._id] = cur.count;
      return acc;
    }, {});

    ok(res, {
      customers: { total: totalCustomers },
      riders: {
        total: totalRiders,
        pending: pendingRiders,
        verified: verifiedRiders,
        rejected: rejectedRiders,
      },
      washers: {
        total: totalWashers,
        pending: pendingWashers,
        verified: verifiedWashers,
        rejected: rejectedWashers,
      },
      orders: { total: totalOrders, byStatus: ordersByStatus },
      complaints: { total: totalComplaints, pending: pendingComplaints },
      subAdmins: { total: subAdminCount },
      revenue: { totalPaid: revenueAgg[0]?.total || 0 },
    });
  } catch (err) {
    fail(res, err.message);
  }
};

/* =========================================================================
 * COMPLAINTS — "help / raise a complaint" requests, visible on the admin
 * side. Reuses the existing Complaint model (customers submit via
 * POST /api/complaints, with photos).
 * ========================================================================= */

// GET /api/admin/complaints?status=pending|in-review|resolved|rejected
exports.listComplaints = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const query = {};
    if (req.query.status) query.status = req.query.status;

    const [complaintsRaw, total] = await Promise.all([
      Complaint.find(query)
        .populate({ path: 'user', select: 'email mobile' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Complaint.countDocuments(query),
    ]);

    const userAccountIds = complaintsRaw.map((c) => c.user?._id || c.user).filter(Boolean);
    const customers = await Customer.find({ accountId: { $in: userAccountIds } }).select(
      'accountId fullName phone'
    );
    const customerByAccountId = new Map(
      customers.map((c) => [c.accountId.toString(), c])
    );

    const complaints = complaintsRaw.map((complaint) => {
      const cObj = complaint.toObject();
      const accountIdStr = (cObj.user?._id || cObj.user || '').toString();
      const customer = customerByAccountId.get(accountIdStr);
      if (customer) {
        cObj.customer = {
          _id: customer._id,
          fullName: customer.fullName,
          phone: customer.phone,
        };
        if (cObj.user && typeof cObj.user === 'object') {
          cObj.user.fullName = customer.fullName;
          cObj.user.phone = customer.phone;
        }
      }
      return cObj;
    });

    ok(res, { complaints, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    fail(res, err.message);
  }
};

// GET /api/admin/complaints/:id
exports.getComplaintById = async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id).populate({
      path: 'user',
      select: 'email mobile',
    });
    if (!complaint) return fail(res, 'Complaint not found', 404);

    const cObj = complaint.toObject();
    const accountIdStr = (cObj.user?._id || cObj.user || '').toString();
    const customer = await Customer.findOne({ accountId: accountIdStr }).select(
      'accountId fullName phone'
    );
    if (customer) {
      cObj.customer = {
        _id: customer._id,
        fullName: customer.fullName,
        phone: customer.phone,
      };
      if (cObj.user && typeof cObj.user === 'object') {
        cObj.user.fullName = customer.fullName;
        cObj.user.phone = customer.phone;
      }
    }

    ok(res, cObj);
  } catch (err) {
    fail(res, err.message);
  }
};

// PATCH /api/admin/complaints/:id — resolve/reject with a remark
exports.updateComplaintStatus = async (req, res) => {
  try {
    const { status, adminRemarks } = req.body;
    const validStatuses = ['pending', 'in-review', 'resolved', 'rejected'];
    if (status && !validStatuses.includes(status)) {
      return fail(res, `status must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const update = {};
    if (status) update.status = status;
    if (adminRemarks !== undefined) update.adminRemarks = adminRemarks;
    if (Object.keys(update).length === 0) {
      return fail(res, 'Provide status and/or adminRemarks', 400);
    }

    const complaint = await Complaint.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!complaint) return fail(res, 'Complaint not found', 404);
    ok(res, complaint);
  } catch (err) {
    fail(res, err.message);
  }
};



// POST /api/admin/subadmins
exports.createSubAdmin = async (req, res) => {
  try {
    const { fullName, email, mobile, password, permissions = [] } = req.body;

    if (!fullName || !email || !mobile || !password) {
      return fail(res, 'fullName, email, mobile and password are required', 400);
    }

    const invalidPerms = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
    if (invalidPerms.length > 0) {
      return fail(res, `Unknown permission(s): ${invalidPerms.join(', ')}`, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedMobile = normalizeMobile(mobile);

    if (await Account.findOne({ email: normalizedEmail })) {
      return fail(res, 'Email already registered', 409);
    }
    if (await Account.findOne({ mobile: normalizedMobile })) {
      return fail(res, 'Mobile already registered', 409);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const account = await Account.create({
      email: normalizedEmail,
      mobile: normalizedMobile,
      password: hashedPassword,
      role: 'subadmin',
      isVerified: true, // created directly by the super admin — no OTP step needed
    });

    const subAdmin = await Admin.create({
      accountId: account._id,
      fullName: fullName.trim(),
      level: 'subadmin',
      permissions,
      createdBy: req.user.id,
      isActive: true,
    });

    ok(
      res,
      {
        id: subAdmin._id,
        accountId: account._id,
        fullName: subAdmin.fullName,
        email: account.email,
        mobile: account.mobile,
        permissions: subAdmin.permissions,
        isActive: subAdmin.isActive,
      },
      201
    );
  } catch (err) {
    fail(res, err.message);
  }
};

// GET /api/admin/subadmins
exports.listSubAdmins = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req);

    const [subAdmins, total] = await Promise.all([
      Admin.find({ level: 'subadmin' })
        .populate({ path: 'accountId', select: 'email mobile isVerified createdAt' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Admin.countDocuments({ level: 'subadmin' }),
    ]);

    ok(res, { subAdmins, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    fail(res, err.message);
  }
};

// GET /api/admin/subadmins/:id
exports.getSubAdmin = async (req, res) => {
  try {
    const subAdmin = await Admin.findOne({ _id: req.params.id, level: 'subadmin' }).populate({
      path: 'accountId',
      select: 'email mobile isVerified createdAt',
    });
    if (!subAdmin) return fail(res, 'Sub-admin not found', 404);
    ok(res, subAdmin);
  } catch (err) {
    fail(res, err.message);
  }
};

// PATCH /api/admin/subadmins/:id — update name / permissions / active status
exports.updateSubAdmin = async (req, res) => {
  try {
    const { fullName, permissions, isActive } = req.body;

    const subAdmin = await Admin.findOne({ _id: req.params.id, level: 'subadmin' });
    if (!subAdmin) return fail(res, 'Sub-admin not found', 404);

    if (permissions !== undefined) {
      const invalidPerms = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
      if (invalidPerms.length > 0) {
        return fail(res, `Unknown permission(s): ${invalidPerms.join(', ')}`, 400);
      }
      subAdmin.permissions = permissions;
    }
    if (fullName !== undefined) subAdmin.fullName = fullName.trim();
    if (typeof isActive === 'boolean') subAdmin.isActive = isActive;

    await subAdmin.save();
    ok(res, subAdmin);
  } catch (err) {
    fail(res, err.message);
  }
};

// DELETE /api/admin/subadmins/:id — super admin removes a sub-admin entirely
exports.deleteSubAdmin = async (req, res) => {
  try {
    const subAdmin = await Admin.findOne({ _id: req.params.id, level: 'subadmin' });
    if (!subAdmin) return fail(res, 'Sub-admin not found', 404);

    await Promise.all([
      Admin.deleteOne({ _id: subAdmin._id }),
      Account.deleteOne({ _id: subAdmin.accountId }),
    ]);

    ok(res, { message: 'Sub-admin removed' });
  } catch (err) {
    fail(res, err.message);
  }
};

/* =========================================================================
 * ORDERS — admin can see and handle every order in the system
 * ========================================================================= */

// GET /api/admin/orders?status=&search=&from=&to=
exports.listOrders = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const { status, search, from, to } = req.query;

    const query = {};
    if (status) query.status = status;
    if (search) query.orderNumber = { $regex: search, $options: 'i' };
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate({
          path: 'customerId',
          model: 'Customer',
          foreignField: 'accountId',
          select: 'fullName phone profilePhoto addresses accountId',
        })
        .populate({ path: 'riderPickupId', select: 'fullName' })
        .populate({ path: 'riderDeliveryId', select: 'fullName' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(query),
    ]);

    const absolutizedOrders = orders.map((o) => absolutizeOrder(req, o));
    await enrichOrderCustomer(absolutizedOrders);

    ok(res, {
      orders: absolutizedOrders,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    fail(res, err.message);
  }
};

// GET /api/admin/orders/:id
exports.getOrderById = async (req, res) => {
  try {
    const query = resolveOrderQuery(req.params.id);
    const order = await Order.findOne(query)
      .populate({
        path: 'customerId',
        model: 'Customer',
        foreignField: 'accountId',
        select: 'fullName phone profilePhoto addresses accountId',
      })
      .populate({ path: 'riderPickupId', select: 'fullName' })
      .populate({ path: 'riderDeliveryId', select: 'fullName' });
    if (!order) return fail(res, 'Order not found', 404);
    const absolutized = absolutizeOrder(req, order);
    await enrichOrderCustomer(absolutized);
    ok(res, absolutized);
  } catch (err) {
    fail(res, err.message);
  }
};

// PATCH /api/admin/orders/:id/status — admin "accepts"/handles an order by
// moving it to any valid status directly (e.g. resolving a stuck order).
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, note } = req.body;
    if (!status) return fail(res, 'status is required', 400);

    const validStatuses = Order.schema.path('status').enumValues;
    if (!validStatuses.includes(status)) {
      return fail(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const query = resolveOrderQuery(req.params.id);
    const order = await Order.findOneAndUpdate(
      query,
      {
        $set: { status },
        $push: { statusHistory: { status, note: note || `Updated by admin`, updatedAt: new Date() } },
      },
      { new: true }
    );
    if (!order) return fail(res, 'Order not found', 404);

    emitOrderUpdate(order);
    ok(res, order);
  } catch (err) {
    fail(res, err.message);
  }
};

// PATCH /api/admin/orders/:id/assign — manually assign washer / pickup rider
// / delivery rider to an order.
exports.assignOrder = async (req, res) => {
  try {
    const { serviceProviderId, riderPickupId, riderDeliveryId } = req.body;
    const update = {};
    if (serviceProviderId) update.serviceProviderId = serviceProviderId;
    if (riderPickupId) update.riderPickupId = riderPickupId;
    if (riderDeliveryId) update.riderDeliveryId = riderDeliveryId;

    if (Object.keys(update).length === 0) {
      return fail(res, 'Provide at least one of serviceProviderId, riderPickupId, riderDeliveryId', 400);
    }

    const query = resolveOrderQuery(req.params.id);
    const order = await Order.findOneAndUpdate(
      query,
      {
        $set: update,
        $push: { statusHistory: { status: 'reassigned_by_admin', note: 'Reassigned by admin', updatedAt: new Date() } },
      },
      { new: true }
    );
    if (!order) return fail(res, 'Order not found', 404);

    emitOrderUpdate(order);
    ok(res, order);
  } catch (err) {
    fail(res, err.message);
  }
};

// PATCH /api/admin/orders/:id/cancel
exports.cancelOrder = async (req, res) => {
  try {
    const { reason } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: 'cancelled',
          cancellation: { cancelledAt: new Date(), reason: reason || 'Cancelled by admin' },
        },
        $push: { statusHistory: { status: 'cancelled', note: reason || 'Cancelled by admin', updatedAt: new Date() } },
      },
      { new: true }
    );
    if (!order) return fail(res, 'Order not found', 404);

    emitOrderUpdate(order);
    ok(res, order);
  } catch (err) {
    fail(res, err.message);
  }
};

// DELETE /api/admin/orders/:id — Permanently disabled to preserve audit and financial records.
exports.deleteOrder = async (req, res) => {
  return fail(res, 'Order deletion is disabled. Orders cannot be deleted to preserve audit and financial records.', 403);
};

/* =========================================================================
 * RIDERS — view / verify / edit (sub-admin delegable), delete (super admin only)
 * ========================================================================= */

// GET /api/admin/riders?status=pending|verified|rejected
exports.listRiders = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const query = {};
    if (req.query.status) query.verificationStatus = req.query.status;

    const [riders, total] = await Promise.all([
      Rider.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Rider.countDocuments(query),
    ]);

    ok(res, {
      riders: riders.map((r) => absolutizeRider(req, r)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    fail(res, err.message);
  }
};

// GET /api/admin/riders/:id
exports.getRiderById = async (req, res) => {
  try {
    const rider = await Rider.findById(req.params.id);
    if (!rider) return fail(res, 'Rider not found', 404);
    ok(res, absolutizeRider(req, rider));
  } catch (err) {
    fail(res, err.message);
  }
};

// PATCH /api/admin/riders/:id/verify — body: { action: 'verify' | 'reject', reason? }
exports.verifyRider = async (req, res) => {
  try {
    const { action, reason } = req.body;
    if (!['verify', 'reject'].includes(action)) {
      return fail(res, "action must be 'verify' or 'reject'", 400);
    }

    const rider = await Rider.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          verificationStatus: action === 'verify' ? 'verified' : 'rejected',
          isVerified: action === 'verify',
          verificationNote: reason || undefined,
        },
      },
      { new: true }
    );
    if (!rider) return fail(res, 'Rider not found', 404);
    ok(res, absolutizeRider(req, rider));
  } catch (err) {
    fail(res, err.message);
  }
};

// PUT /api/admin/riders/:id — edit profile fields (not delete)
exports.updateRider = async (req, res) => {
  try {
    // Disallow touching auth/verification-sensitive fields through the
    // generic edit endpoint — those go through verifyRider / deleteRider.
    const { accountId, verificationStatus, isVerified, ...rest } = req.body;

    const rider = await Rider.findByIdAndUpdate(req.params.id, { $set: rest }, { new: true });
    if (!rider) return fail(res, 'Rider not found', 404);
    ok(res, absolutizeRider(req, rider));
  } catch (err) {
    fail(res, err.message);
  }
};

// DELETE /api/admin/riders/:id — super admin only
exports.deleteRider = async (req, res) => {
  try {
    const rider = await Rider.findById(req.params.id);
    if (!rider) return fail(res, 'Rider not found', 404);

    await Promise.all([
      Rider.deleteOne({ _id: rider._id }),
      Account.deleteOne({ _id: rider.accountId }),
    ]);

    ok(res, { message: 'Rider removed' });
  } catch (err) {
    fail(res, err.message);
  }
};

/* =========================================================================
 * WASHERS — view / verify / edit (sub-admin delegable), delete (super admin only)
 * ========================================================================= */

// GET /api/admin/washers?status=pending|verified|rejected
exports.listWashers = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const query = {};
    if (req.query.status) query.verificationStatus = req.query.status;

    const [washers, total] = await Promise.all([
      Washer.find(query).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit),
      Washer.countDocuments(query),
    ]);

    ok(res, {
      washers: washers.map((w) => absolutizeWasher(req, w)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    fail(res, err.message);
  }
};

// GET /api/admin/washers/:id
exports.getWasherById = async (req, res) => {
  try {
    const washer = await Washer.findById(req.params.id).select('-password');
    if (!washer) return fail(res, 'Washer not found', 404);
    ok(res, absolutizeWasher(req, washer));
  } catch (err) {
    fail(res, err.message);
  }
};

// PATCH /api/admin/washers/:id/verify — body: { action: 'verify' | 'reject', reason? }
exports.verifyWasher = async (req, res) => {
  try {
    const { action, reason } = req.body;
    if (!['verify', 'reject'].includes(action)) {
      return fail(res, "action must be 'verify' or 'reject'", 400);
    }

    const washer = await Washer.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          verificationStatus: action === 'verify' ? 'verified' : 'rejected',
          isVerified: action === 'verify',
          verificationNote: reason || undefined,
        },
      },
      { new: true }
    ).select('-password');
    if (!washer) return fail(res, 'Washer not found', 404);
    ok(res, absolutizeWasher(req, washer));
  } catch (err) {
    fail(res, err.message);
  }
};

// PUT /api/admin/washers/:id — edit profile fields (not delete)
exports.updateWasher = async (req, res) => {
  try {
    const { password, verificationStatus, isVerified, ...rest } = req.body;

    const washer = await Washer.findByIdAndUpdate(req.params.id, { $set: rest }, { new: true }).select('-password');
    if (!washer) return fail(res, 'Washer not found', 404);
    ok(res, absolutizeWasher(req, washer));
  } catch (err) {
    fail(res, err.message);
  }
};

// DELETE /api/admin/washers/:id — super admin only
exports.deleteWasher = async (req, res) => {
  try {
    const washer = await Washer.findByIdAndDelete(req.params.id);
    if (!washer) return fail(res, 'Washer not found', 404);
    ok(res, { message: 'Washer removed' });
  } catch (err) {
    fail(res, err.message);
  }
};

/* =========================================================================
 * CUSTOMERS — view / edit (sub-admin delegable), delete (super admin only)
 * ========================================================================= */

// GET /api/admin/customers
exports.listCustomers = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req);
    const query = {};
    if (req.query.search) {
      query.fullName = { $regex: req.query.search, $options: 'i' };
    }

    const [customers, total] = await Promise.all([
      Customer.find(query)
        .populate({ path: 'accountId', select: 'email mobile isVerified' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Customer.countDocuments(query),
    ]);

    ok(res, { customers, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    fail(res, err.message);
  }
};

// GET /api/admin/customers/:id
exports.getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).populate({
      path: 'accountId',
      select: 'email mobile isVerified',
    });
    if (!customer) return fail(res, 'Customer not found', 404);
    ok(res, customer);
  } catch (err) {
    fail(res, err.message);
  }
};

// PUT /api/admin/customers/:id — edit profile fields (not delete)
exports.updateCustomer = async (req, res) => {
  try {
    const { accountId, ...rest } = req.body;
    const customer = await Customer.findByIdAndUpdate(req.params.id, { $set: rest }, { new: true });
    if (!customer) return fail(res, 'Customer not found', 404);
    ok(res, customer);
  } catch (err) {
    fail(res, err.message);
  }
};

// DELETE /api/admin/customers/:id — super admin only
exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return fail(res, 'Customer not found', 404);

    await Promise.all([
      Customer.deleteOne({ _id: customer._id }),
      Account.deleteOne({ _id: customer.accountId }),
    ]);

    ok(res, { message: 'Customer removed' });
  } catch (err) {
    fail(res, err.message);
  }
};