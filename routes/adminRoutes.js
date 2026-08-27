const express = require('express');
const router = express.Router();

const {
  protect,
  restrictTo,
  loadAdminProfile,
  superAdminOnly,
  requirePermission,
  requireBootstrapSecretOrSuperAdmin,
} = require('../middleware/auth');
const { PERMISSIONS } = require('../constants/permissions');
const ctrl = require('../controllers/adminController');

/* ── One-time admin bootstrap — NO login required ─────────────────────
 * Creates the very first super admin. Gated by the ADMIN_BOOTSTRAP_SECRET
 * header + the AdminBootstrap DB flag (starts enabled, auto-disables
 * itself right after a successful creation). To create another admin
 * later, re-enable it first via PATCH .../bootstrap/enable — that route
 * itself requires either the developer's secret header or an
 * already-authenticated super admin, so this can't be re-opened by
 * anyone else. */
router.post('/bootstrap', ctrl.bootstrapAdmin);
router.get('/bootstrap/status', requireBootstrapSecretOrSuperAdmin, ctrl.getBootstrapStatus);
router.patch('/bootstrap/enable', requireBootstrapSecretOrSuperAdmin, ctrl.enableAdminBootstrap);
router.patch('/bootstrap/disable', requireBootstrapSecretOrSuperAdmin, ctrl.disableAdminBootstrap);

/* ── Everything below requires a normal admin/sub-admin login ────────── */
router.use(protect, restrictTo('admin', 'subadmin'), loadAdminProfile);

/* ── Self / permission catalog ─────────────────────────────────────── */
router.get('/me', ctrl.getMe);
router.get('/permissions', ctrl.listPermissions);

/* ── Dashboard — "see all the things the app is working on" ─────────── */
router.get('/dashboard', requirePermission(PERMISSIONS.VIEW_DASHBOARD), ctrl.getDashboardOverview);

/* ── Complaints / help requests raised by customers ───────────────────── */
router.get('/complaints', requirePermission(PERMISSIONS.VIEW_COMPLAINTS), ctrl.listComplaints);
router.get('/complaints/:id', requirePermission(PERMISSIONS.VIEW_COMPLAINTS), ctrl.getComplaintById);
router.patch('/complaints/:id', requirePermission(PERMISSIONS.MANAGE_COMPLAINTS), ctrl.updateComplaintStatus);

/* ── Sub-admin management — super admin only, always ─────────────────
 * Creating/editing/removing sub-admins can never be delegated to a
 * sub-admin, regardless of what permissions they hold. */
router.post('/subadmins', superAdminOnly, ctrl.createSubAdmin);
router.get('/subadmins', superAdminOnly, ctrl.listSubAdmins);
router.get('/subadmins/:id', superAdminOnly, ctrl.getSubAdmin);
router.patch('/subadmins/:id', superAdminOnly, ctrl.updateSubAdmin);
router.delete('/subadmins/:id', superAdminOnly, ctrl.deleteSubAdmin);

/* ── Full admins — an existing super admin can create/see other super
 * admins directly (distinct from the one-time /bootstrap flow, and from
 * sub-admins — this creates another unrestricted admin). ────────────── */
router.post('/admins', superAdminOnly, ctrl.createAdmin);
router.get('/admins', superAdminOnly, ctrl.listAdmins);

/* ── Orders — admin/sub-admin can see and handle every order ─────────── */
router.get('/orders', requirePermission(PERMISSIONS.VIEW_ORDERS), ctrl.listOrders);
router.get('/orders/:id', requirePermission(PERMISSIONS.VIEW_ORDERS), ctrl.getOrderById);
router.patch('/orders/:id/status', requirePermission(PERMISSIONS.MANAGE_ORDERS), ctrl.updateOrderStatus);
router.patch('/orders/:id/assign', requirePermission(PERMISSIONS.MANAGE_ORDERS), ctrl.assignOrder);
router.patch('/orders/:id/cancel', requirePermission(PERMISSIONS.MANAGE_ORDERS), ctrl.cancelOrder);
router.delete('/orders/:id', superAdminOnly, ctrl.deleteOrder); // destructive — super admin only

/* ── Riders — verify/edit delegable, delete is super-admin-only ──────── */
router.get('/riders', requirePermission(PERMISSIONS.VIEW_RIDERS), ctrl.listRiders);
router.get('/riders/:id', requirePermission(PERMISSIONS.VIEW_RIDERS), ctrl.getRiderById);
router.patch('/riders/:id/verify', requirePermission(PERMISSIONS.VERIFY_RIDERS), ctrl.verifyRider);
router.put('/riders/:id', requirePermission(PERMISSIONS.EDIT_RIDERS), ctrl.updateRider);
router.delete('/riders/:id', superAdminOnly, ctrl.deleteRider);

/* ── Washers — verify/edit delegable, delete is super-admin-only ─────── */
router.get('/washers', requirePermission(PERMISSIONS.VIEW_WASHERS), ctrl.listWashers);
router.get('/washers/:id', requirePermission(PERMISSIONS.VIEW_WASHERS), ctrl.getWasherById);
router.patch('/washers/:id/verify', requirePermission(PERMISSIONS.VERIFY_WASHERS), ctrl.verifyWasher);
router.put('/washers/:id', requirePermission(PERMISSIONS.EDIT_WASHERS), ctrl.updateWasher);
router.delete('/washers/:id', superAdminOnly, ctrl.deleteWasher);

/* ── Customers — edit delegable, delete is super-admin-only ──────────── */
router.get('/customers', requirePermission(PERMISSIONS.VIEW_CUSTOMERS), ctrl.listCustomers);
router.get('/customers/:id', requirePermission(PERMISSIONS.VIEW_CUSTOMERS), ctrl.getCustomerById);
router.put('/customers/:id', requirePermission(PERMISSIONS.EDIT_CUSTOMERS), ctrl.updateCustomer);
router.delete('/customers/:id', superAdminOnly, ctrl.deleteCustomer);

module.exports = router;