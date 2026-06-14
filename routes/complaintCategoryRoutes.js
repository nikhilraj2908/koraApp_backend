const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const {
  getComplaintCategories,
  createComplaintCategory,
  updateComplaintCategory,
  deleteComplaintCategory,
} = require('../controllers/complaintCategoryController');

// Public: get all active complaint categories
router.get('/', getComplaintCategories);

// Admin only: create, update, delete
router.post('/', protect, restrictTo('admin'), createComplaintCategory);
router.put('/:id', protect, restrictTo('admin'), updateComplaintCategory);
router.delete('/:id', protect, restrictTo('admin'), deleteComplaintCategory);

module.exports = router;