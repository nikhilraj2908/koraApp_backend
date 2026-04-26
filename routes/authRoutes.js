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

const router = express.Router();


// Registration (username + password + mobile)
router.post('/register', register);

// Username + Password login
router.post('/login', loginWithUsername);

// Mobile + OTP login
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
// Forgot password (reset) routes
router.post('/forgot-password', forgotPassword);
router.post('/verify-reset-otp', verifyResetOtp);
router.post('/reset-password', resetPassword);
// Logout
router.post('/logout', logout);

module.exports = router;