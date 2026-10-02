/**
 * routes/serviceAreaRoutes.js
 *
 * Public routes for Service Area checks and active service area discovery.
 */

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/serviceAreaController');

// Public endpoints
router.get('/active', ctrl.getActiveServiceArea);
router.post('/check', ctrl.checkCoverage);

module.exports = router;
