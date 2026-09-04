const rateLimit = require("express-rate-limit");

const limiter = (windowMinutes, max, message) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

// ─── Sending or verifying an OTP: max 20 attempts per 15 min per IP ─────────
// Prevents OTP brute-force and SMS spam.
exports.otpLimiter = limiter(15, 20, 'Too many OTP requests. Please wait 15 minutes and try again.');

// ─── Auth routes (login / register / enroll): max 30 attempts per 15 min per IP
// Protects against credential stuffing without blocking legitimate users.
exports.authLimiter = limiter(15, 30, 'Too many login attempts. Please wait 15 minutes and try again.');

// ─── Password reset: max 5 reset attempts per hour per IP ────────────────────
exports.resetLimiter = limiter(60, 5, 'Too many password reset attempts. Please try again in an hour.');

// ─── Services public reads: max 120 requests per minute per IP ───────────────
// Covers home screen refresh loops and catalog browsing.
exports.publicReadLimiter = limiter(1, 120, 'Too many requests. Please slow down.');

// ─── General API limiter (optional for specific heavy routes) ────────────────
exports.apiLimiter = limiter(10, 1000, 'Too many requests. Please slow down.');
