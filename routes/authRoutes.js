const express = require('express');
const {
  register,
  login,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  logout,
  verifyEmail,               // new
  resendVerificationOtp,     // new
  googleAuth                 // new
} = require('../controllers/authController');
const { authLimiter, resetLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Public routes (with rate limiting)
router.post('/register', authLimiter, register);
router.post('/verify-email', authLimiter, verifyEmail);                     // verify email OTP
router.post('/resend-verification', authLimiter, resendVerificationOtp);   // resend verification OTP
router.post('/login', authLimiter, login);
router.post('/google-auth', authLimiter, googleAuth);                      // Google sign‑in/up
router.post('/forgot-password', resetLimiter, forgotPassword);
router.post('/verify-reset-otp', resetLimiter, verifyResetOtp);
router.post('/reset-password', resetLimiter, resetPassword);
router.post('/logout', logout);

module.exports = router;