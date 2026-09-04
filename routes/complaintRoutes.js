const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  createComplaint,
  getUserComplaints,
  getComplaintById,
  getAllComplaints,
  updateComplaintStatus,
} = require('../controllers/complaintController');

// User routes
router.post('/', protect,  upload.array("photos", 3), createComplaint);
router.get('/my', protect, getUserComplaints);
router.get('/:id', protect, getComplaintById);

// Admin / subadmin routes
router.get('/admin/all', protect, restrictTo('admin', 'subadmin'), getAllComplaints);
router.patch('/admin/:id/status', protect, restrictTo('admin', 'subadmin'), updateComplaintStatus);

module.exports = router;