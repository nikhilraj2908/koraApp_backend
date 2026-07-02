const express = require('express');
const Customer = require('../models/Customer');

const {
  getProfile,
   requestEmailOtp, verifyEmailOtp, requestMobileOtp, verifyMobileOtp,
  updateProfile,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} = require('../controllers/customerController');

const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// ─── PROFILE ─────────────────────────────────────────────

// Get logged-in customer profile
router.get(
  '/profile',
  protect,
  restrictTo('customer'),
  getProfile
);

// Update logged-in customer profile
router.put(
  '/profile',
  protect,
  restrictTo('customer'),
  updateProfile
);


// ─── ADDRESSES ───────────────────────────────────────────

// Add address
router.post(
  '/addresses',
  protect,
  restrictTo('customer'),
  addAddress
);

// Update address
router.put(
  '/addresses/:addressId',
  protect,
  restrictTo('customer'),
  updateAddress
);

// Delete address
router.delete(
  '/addresses/:addressId',
  protect,
  restrictTo('customer'),
  deleteAddress
);

// Set default address
router.put(
  '/addresses/:addressId/default',
  protect,
  restrictTo('customer'),
  setDefaultAddress
);

// router.put(
//   '/profile/email',
//   protect,
//   restrictTo('customer'),
//   updateEmail
// );
module.exports = router;