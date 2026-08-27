/**
 * constants/permissions.js
 *
 * Single source of truth for every permission a sub-admin can be granted.
 *
 * Two-tier admin model:
 *  - Super admin (Account.role === 'admin')   -> always has EVERY permission
 *    below, automatically, and can additionally do things that are NEVER
 *    delegable to a sub-admin no matter what permissions they hold
 *    (deleting riders/washers/customers, creating/editing/removing
 *    sub-admins). Those actions are gated by `superAdminOnly` in
 *    middleware/auth.js, not by anything in this list.
 *  - Sub-admin (Account.role === 'subadmin')  -> only has whatever subset
 *    of PERMISSIONS the super admin explicitly assigned on their
 *    models/Admin.js profile (`permissions: [...]`).
 */

const PERMISSIONS = {
  // Dashboard / global visibility
  VIEW_DASHBOARD: 'dashboard.view',

  // Orders
  VIEW_ORDERS: 'orders.view',
  MANAGE_ORDERS: 'orders.manage', // accept/handle, change status, assign rider/washer, cancel

  // Riders
  VIEW_RIDERS: 'riders.view',
  VERIFY_RIDERS: 'riders.verify', // approve/reject rider KYC/documents
  EDIT_RIDERS: 'riders.edit',     // edit rider profile fields (not delete)

  // Washers / service providers
  VIEW_WASHERS: 'washers.view',
  VERIFY_WASHERS: 'washers.verify', // approve/reject washer KYC/shop docs
  EDIT_WASHERS: 'washers.edit',     // edit washer profile fields (not delete)

  // Customers
  VIEW_CUSTOMERS: 'customers.view',
  EDIT_CUSTOMERS: 'customers.edit', // (not delete)

  // Complaints / support
  VIEW_COMPLAINTS: 'complaints.view',
  MANAGE_COMPLAINTS: 'complaints.manage',

  // Platform configuration (dispatch pricing/slots/etc.)
  MANAGE_CONFIG: 'config.manage',
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

module.exports = { PERMISSIONS, ALL_PERMISSIONS };