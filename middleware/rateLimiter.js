const rateLimit =require("express-rate-limit")
const limiter=(windowMinutes,max,message)=>
    rateLimit({
        windowMs:windowMinutes*60*1000,
        max,    
        standardHeaders:true,
        legacyHeaders:false,
        message:{success:false,message}
    })

    // exports.otpLimiter=limiter(15,5,'Too many otp requests. please wait 15 min and retry again')
    // Sending or verifying an OTP: max 5 attempts per 15 min per IP.
// Prevents OTP brute-force and Twilio bill abuse.
exports.otpLimiter = limiter(1, 200, 'Too many OTP requests. Please wait 15 minutes and try again.');

// ─── Auth routes (login / register) ──────────────────────────────────────────
// Max 10 attempts per 15 min per IP.
// Slows down credential stuffing without blocking legit users.
exports.authLimiter = limiter(1, 200, 'Too many login attempts. Please wait 15 minutes and try again.');

// ─── Password reset ───────────────────────────────────────────────────────────
// Max 5 reset attempts per hour per IP.
exports.resetLimiter = limiter(60, 5, 'Too many password reset attempts. Please try again in an hour.');

// ─── General API (cart, profile, services) ───────────────────────────────────
// Max 100 requests per 10 min per IP — generous for normal app use.
exports.apiLimiter = limiter(10, 100, 'Too many requests. Please slow down.');

// ─── Services public reads ────────────────────────────────────────────────────
// Max 60 requests per minute — covers home screen refresh loops.
exports.publicReadLimiter = limiter(1, 60, 'Too many requests. Please slow down.');
