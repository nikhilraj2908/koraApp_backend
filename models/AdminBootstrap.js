const mongoose = require('mongoose');

/**
 * Singleton document (there is only ever one) that gates
 * POST /api/admin/bootstrap — the unauthenticated endpoint used to create
 * the very first super admin (or a replacement one, later).
 *
 * Starts `enabled: true` so a fresh deployment can bootstrap its first
 * admin immediately. The bootstrap endpoint flips this to `false`
 * automatically the moment it succeeds, so it can't be called again by
 * accident. To create another admin later, an existing super admin (or the
 * developer, via ADMIN_BOOTSTRAP_SECRET) flips it back on, creates the
 * admin, and it's expected to be turned off again afterwards.
 */
const AdminBootstrapSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: true },
  updatedAt: { type: Date, default: Date.now },
  // Bookkeeping only — not used for any access-control decision.
  lastEnabledBy: { type: String, default: null }, // 'developer-secret' | accountId string
  lastCreatedAdminAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
});

module.exports = mongoose.model('AdminBootstrap', AdminBootstrapSchema);