const express = require('express');

const {
  register,
  loginWithUsername,
  sendOtp,
  verifyOtp,
  logout,
  forgotPassword,
  verifyResetOtp,
  resetPassword
} = require('../controllers/authController');

const {
  authLimiter,
  otpLimiter,
  resetLimiter
} = require('../middleware/rateLimiter');

const router = express.Router();


// Registration
router.post('/register', authLimiter, register);

// Username + Password login
router.post('/login', authLimiter, loginWithUsername);

// Mobile + OTP login
router.post('/send-otp', otpLimiter, sendOtp);

router.post('/verify-otp', otpLimiter, verifyOtp);

// Forgot password
router.post('/forgot-password', resetLimiter, forgotPassword);

router.post('/verify-reset-otp', resetLimiter, verifyResetOtp);

router.post('/reset-password', resetLimiter, resetPassword);

// Logout
router.post('/logout', logout);

module.exports = router;