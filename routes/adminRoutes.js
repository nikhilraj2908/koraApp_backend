const express = require('express');
const router = express.Router();

const {
  protect,
  restrictTo,
  loadAdminProfile,
  superAdminOnly,
  requirePermission,
  requireBootstrapSecretOrSuperAdmin,
  scopeServiceAreas,
} = require('../middleware/auth');
const { PERMISSIONS } = require('../constants/permissions');
const ctrl = require('../controllers/adminController');
const serviceAreaCtrl = require('../controllers/serviceAreaController');
const chatCtrl = require('../controllers/chatController');
const userMgmtCtrl = require('../controllers/userManagementController');
const geoUpload = require('../middleware/geoUpload');

/* ── One-time admin bootstrap — NO login required ─────────────────────── */
router.post('/bootstrap', ctrl.bootstrapAdmin);
router.get('/bootstrap/status', requireBootstrapSecretOrSuperAdmin, ctrl.getBootstrapStatus);
router.patch('/bootstrap/enable', requireBootstrapSecretOrSuperAdmin, ctrl.enableAdminBootstrap);
router.patch('/bootstrap/disable', requireBootstrapSecretOrSuperAdmin, ctrl.disableAdminBootstrap);

/* ── Everything below requires a normal admin/sub-admin/regional_manager login ── */
router.use(
  protect,
  restrictTo('admin', 'subadmin', 'regional_manager'),
  loadAdminProfile
);

/* ── Self / profile / permission catalog ────────────────────────────────── */
router.get('/me', ctrl.getMe);
router.get('/permissions', ctrl.listPermissions);

/* ── Dashboard ──────────────────────────────────────────────────────────── */
router.get(
  '/dashboard',
  requirePermission(PERMISSIONS.VIEW_DASHBOARD),
  scopeServiceAreas,
  ctrl.getDashboardOverview
);

/* ── Complaints ─────────────────────────────────────────────────────────── */
router.get('/complaints', requirePermission(PERMISSIONS.VIEW_COMPLAINTS), ctrl.listComplaints);
router.get('/complaints/:id', requirePermission(PERMISSIONS.VIEW_COMPLAINTS), ctrl.getComplaintById);
router.patch('/complaints/:id', requirePermission(PERMISSIONS.MANAGE_COMPLAINTS), ctrl.updateComplaintStatus);

/* ── Internal User Management (Sub-admins + Regional Managers) ──────────
 * All super-admin-only. Use /api/admin/users as the single unified surface. */
router.get('/users', superAdminOnly, userMgmtCtrl.listUsers);
router.post('/users', superAdminOnly, userMgmtCtrl.createUser);
router.get('/users/:id', superAdminOnly, userMgmtCtrl.getUser);
router.patch('/users/:id', superAdminOnly, userMgmtCtrl.updateUser);
router.patch('/users/:id/service-areas', superAdminOnly, userMgmtCtrl.updateServiceAreas);
router.patch('/users/:id/permissions', superAdminOnly, userMgmtCtrl.updatePermissions);
router.patch('/users/:id/status', superAdminOnly, userMgmtCtrl.updateStatus);
router.post('/users/:id/reset-password', superAdminOnly, userMgmtCtrl.resetPassword);

/* ── Legacy sub-admin routes — kept for backward compatibility ──────────── */
router.post('/subadmins', superAdminOnly, ctrl.createSubAdmin);
router.get('/subadmins', superAdminOnly, ctrl.listSubAdmins);
router.get('/subadmins/:id', superAdminOnly, ctrl.getSubAdmin);
router.patch('/subadmins/:id', superAdminOnly, ctrl.updateSubAdmin);
router.delete('/subadmins/:id', superAdminOnly, ctrl.deleteSubAdmin);

/* ── Full admins ────────────────────────────────────────────────────────── */
router.post('/admins', superAdminOnly, ctrl.createAdmin);
router.get('/admins', superAdminOnly, ctrl.listAdmins);

/* ── Orders — with service-area scoping for managers ───────────────────── */
router.get(
  '/orders',
  requirePermission(PERMISSIONS.VIEW_ORDERS),
  scopeServiceAreas,
  ctrl.listOrders
);
router.get(
  '/orders/:id',
  requirePermission(PERMISSIONS.VIEW_ORDERS),
  scopeServiceAreas,
  ctrl.getOrderById
);
router.patch(
  '/orders/:id/status',
  requirePermission(PERMISSIONS.MANAGE_ORDERS),
  scopeServiceAreas,
  ctrl.updateOrderStatus
);
router.patch(
  '/orders/:id/assign',
  requirePermission(PERMISSIONS.MANAGE_ORDERS),
  scopeServiceAreas,
  ctrl.assignOrder
);
// Order deletion and admin cancellation permanently disabled.
router.patch('/orders/:id/cancel', (req, res) => {
  res.status(403).json({
    success: false,
    message: 'Admin order cancellation is disabled. Orders must be cancelled by customers within the 2-hour window.',
  });
});
router.delete('/orders/:id', (req, res) => {
  res.status(403).json({
    success: false,
    message: 'Order deletion is disabled to preserve audit and financial records.',
  });
});

/* ── Riders — with service-area scoping ────────────────────────────────── */
router.get(
  '/riders',
  requirePermission(PERMISSIONS.VIEW_RIDERS),
  scopeServiceAreas,
  ctrl.listRiders
);
router.get(
  '/riders/:id',
  requirePermission(PERMISSIONS.VIEW_RIDERS),
  scopeServiceAreas,
  ctrl.getRiderById
);
router.patch(
  '/riders/:id/verify',
  requirePermission(PERMISSIONS.VERIFY_RIDERS),
  scopeServiceAreas,
  ctrl.verifyRider
);
router.put(
  '/riders/:id',
  requirePermission(PERMISSIONS.EDIT_RIDERS),
  scopeServiceAreas,
  ctrl.updateRider
);
router.delete('/riders/:id', superAdminOnly, ctrl.deleteRider);

/* ── Washers — with service-area scoping ───────────────────────────────── */
router.get(
  '/washers',
  requirePermission(PERMISSIONS.VIEW_WASHERS),
  scopeServiceAreas,
  ctrl.listWashers
);
router.get(
  '/washers/:id',
  requirePermission(PERMISSIONS.VIEW_WASHERS),
  scopeServiceAreas,
  ctrl.getWasherById
);
router.patch(
  '/washers/:id/verify',
  requirePermission(PERMISSIONS.VERIFY_WASHERS),
  scopeServiceAreas,
  ctrl.verifyWasher
);
router.put(
  '/washers/:id',
  requirePermission(PERMISSIONS.EDIT_WASHERS),
  scopeServiceAreas,
  ctrl.updateWasher
);
router.delete('/washers/:id', superAdminOnly, ctrl.deleteWasher);

/* ── Customers ─────────────────────────────────────────────────────────── */
router.get('/customers', requirePermission(PERMISSIONS.VIEW_CUSTOMERS), ctrl.listCustomers);
router.get('/customers/:id', requirePermission(PERMISSIONS.VIEW_CUSTOMERS), ctrl.getCustomerById);
router.put('/customers/:id', requirePermission(PERMISSIONS.EDIT_CUSTOMERS), ctrl.updateCustomer);
router.delete('/customers/:id', superAdminOnly, ctrl.deleteCustomer);

/* ── Service Areas — view/manage with area-level authorization ─────────── */
router.get(
  '/service-areas',
  requirePermission(PERMISSIONS.VIEW_SERVICE_AREAS),
  scopeServiceAreas,
  serviceAreaCtrl.listServiceAreas
);
router.post(
  '/service-areas',
  superAdminOnly, // creating new areas is super-admin-only
  geoUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'geojson', maxCount: 1 }]),
  serviceAreaCtrl.createServiceArea
);
router.get(
  '/service-areas/:id',
  requirePermission(PERMISSIONS.VIEW_SERVICE_AREAS),
  scopeServiceAreas,
  serviceAreaCtrl.getServiceAreaById
);
router.patch(
  '/service-areas/:id/activate',
  requirePermission(PERMISSIONS.MANAGE_SERVICE_AREAS),
  scopeServiceAreas,
  serviceAreaCtrl.activateServiceArea
);
router.patch(
  '/service-areas/:id/deactivate',
  requirePermission(PERMISSIONS.MANAGE_SERVICE_AREAS),
  scopeServiceAreas,
  serviceAreaCtrl.deactivateServiceArea
);
router.put(
  '/service-areas/:id/boundary',
  requirePermission(PERMISSIONS.MANAGE_SERVICE_AREAS),
  scopeServiceAreas,
  geoUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'geojson', maxCount: 1 }]),
  serviceAreaCtrl.updateBoundary
);
router.patch(
  '/service-areas/:id/boundary',
  requirePermission(PERMISSIONS.MANAGE_SERVICE_AREAS),
  scopeServiceAreas,
  geoUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'geojson', maxCount: 1 }]),
  serviceAreaCtrl.updateBoundary
);

/* ── Internal Chat ──────────────────────────────────────────────────────── */
router.get(
  '/chat/unread',
  requirePermission(PERMISSIONS.VIEW_CHAT),
  chatCtrl.getUnreadCount
);
router.get(
  '/chat/conversations',
  requirePermission(PERMISSIONS.VIEW_CHAT),
  chatCtrl.listConversations
);
router.post(
  '/chat/conversations',
  requirePermission(PERMISSIONS.SEND_CHAT),
  chatCtrl.createOrGetConversation
);
router.get(
  '/chat/conversations/:id/messages',
  requirePermission(PERMISSIONS.VIEW_CHAT),
  chatCtrl.getMessages
);
router.post(
  '/chat/conversations/:id/messages',
  requirePermission(PERMISSIONS.SEND_CHAT),
  chatCtrl.sendMessage
);
router.patch(
  '/chat/conversations/:id/read',
  requirePermission(PERMISSIONS.VIEW_CHAT),
  chatCtrl.markRead
);

module.exports = router;