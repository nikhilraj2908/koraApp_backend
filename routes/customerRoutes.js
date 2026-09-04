const express = require('express');
const Customer = require('../models/Customer');

const {
  getProfile,
   requestEmailOtp, verifyEmailOtp, requestMobileOtp, verifyMobileOtp,
  updateProfile,
  setInitialMobile,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} = require('../controllers/customerController');

const { protect, restrictTo } = require('../middleware/auth');
const { otpLimiter } = require('../middleware/rateLimiter');

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

// Set mobile number for the first time (onboarding, unverified — no OTP)
router.put(
  '/profile/set-initial-mobile',
  protect,
  restrictTo('customer'),
  setInitialMobile
);

// ─── EMAIL & MOBILE CHANGE (OTP) ─────────────────────────

// Request OTP to change email
router.post(
  '/email/request-otp',
  protect,
  restrictTo('customer'),
  otpLimiter,
  requestEmailOtp
);
router.post(
  '/profile/email/request-otp',
  protect,
  restrictTo('customer'),
  otpLimiter,
  requestEmailOtp
);

// Verify OTP to change email
router.post(
  '/email/verify-otp',
  protect,
  restrictTo('customer'),
  otpLimiter,
  verifyEmailOtp
);
router.post(
  '/profile/email/verify-otp',
  protect,
  restrictTo('customer'),
  otpLimiter,
  verifyEmailOtp
);

// Request OTP to change mobile number
router.post(
  '/mobile/request-otp',
  protect,
  restrictTo('customer'),
  otpLimiter,
  requestMobileOtp
);
router.post(
  '/profile/mobile/request-otp',
  protect,
  restrictTo('customer'),
  otpLimiter,
  requestMobileOtp
);

// Verify OTP to change mobile number
router.post(
  '/mobile/verify-otp',
  protect,
  restrictTo('customer'),
  otpLimiter,
  verifyMobileOtp
);
router.post(
  '/profile/mobile/verify-otp',
  protect,
  restrictTo('customer'),
  otpLimiter,
  verifyMobileOtp
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