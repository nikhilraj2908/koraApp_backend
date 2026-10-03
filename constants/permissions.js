/**
 * constants/permissions.js
 *
 * Single source of truth for every permission a sub-admin or regional manager
 * can be granted.
 *
 * Three-tier admin model:
 *  - Super admin (Account.role === 'admin')                  -> always has EVERY permission.
 *  - Sub-admin (Account.role === 'subadmin')                 -> has explicitly granted permissions.
 *  - Regional Manager (Account.role === 'regional_manager')  -> has granted permissions
 *    AND is restricted to their assigned serviceAreaIds.
 *
 * Super-admin-only actions (delete riders/washers/customers, create/edit/remove
 * managers) are gated by `superAdminOnly` in middleware/auth.js, not here.
 */

const PERMISSIONS = {
  // Dashboard / global visibility
  VIEW_DASHBOARD: 'dashboard.view',

  // Orders
  VIEW_ORDERS: 'orders.view',
  VIEW_ORDER_DETAILS: 'orders.viewDetails',
  UPDATE_ORDERS: 'orders.update',
  ASSIGN_ORDERS: 'orders.assign',
  MANAGE_ORDERS: 'orders.manage', // change status, assign rider/washer, cancel

  // Riders
  VIEW_RIDERS: 'riders.view',
  VIEW_RIDER_DETAILS: 'riders.viewDetails',
  VERIFY_RIDERS: 'riders.verify',
  EDIT_RIDERS: 'riders.edit',
  MANAGE_RIDERS: 'riders.manage',

  // Washers / service providers
  VIEW_WASHERS: 'washers.view',
  VIEW_WASHER_DETAILS: 'washers.viewDetails',
  VERIFY_WASHERS: 'washers.verify',
  EDIT_WASHERS: 'washers.edit',
  MANAGE_WASHERS: 'washers.manage',

  // Customers
  VIEW_CUSTOMERS: 'customers.view',
  VIEW_CUSTOMER_DETAILS: 'customers.viewDetails',
  EDIT_CUSTOMERS: 'customers.edit',

  // Complaints / support
  VIEW_COMPLAINTS: 'complaints.view',
  MANAGE_COMPLAINTS: 'complaints.manage',

  // Platform configuration
  MANAGE_CONFIG: 'config.manage',

  // Service areas / geospatial boundaries
  VIEW_SERVICE_AREAS: 'serviceAreas.view',
  MANAGE_SERVICE_AREAS: 'serviceAreas.manage',

  // Internal user management (sub-admins / regional managers)
  VIEW_USERS: 'users.view',
  MANAGE_USERS: 'users.manage',

  // Reports
  VIEW_REPORTS: 'reports.view',

  // Internal chat
  VIEW_CHAT: 'chat.view',
  SEND_CHAT: 'chat.send',
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

module.exports = { PERMISSIONS, ALL_PERMISSIONS };