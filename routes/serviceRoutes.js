const express = require('express');
const {
  getAllServices,
  getServiceById,
  getServiceBySlug,
  createService,
  updateService,
  toggleServiceStatus,
  deleteService,
  seedServices
} = require('../controllers/serviceController');

const { protect, restrictTo } = require('../middleware/auth');
const { publicReadLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// ─── Public read endpoints (rate limited) ──────────────────────────
router.get('/', publicReadLimiter, getAllServices);
router.get('/slug/:slug', publicReadLimiter, getServiceBySlug);
router.get('/:id', publicReadLimiter, getServiceById);

// ─── Protected admin mutation endpoints ────────────────────────────
router.post('/seed', protect, restrictTo('admin'), seedServices);
router.post('/', protect, restrictTo('admin', 'subadmin'), createService);
router.put('/:id', protect, restrictTo('admin', 'subadmin'), updateService);
router.patch('/:id/toggle', protect, restrictTo('admin', 'subadmin'), toggleServiceStatus);
router.delete('/:id', protect, restrictTo('admin'), deleteService);

module.exports = router;