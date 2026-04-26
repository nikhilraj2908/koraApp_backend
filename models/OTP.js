const mongoose = require('mongoose');

const OTPSchema = new mongoose.Schema({
  mobile: { type: String, required: true },
  otp: { type: String, required: true },
  purpose: { type: String, enum: ['login', 'reset'], default: 'login' },
  expiresAt: { type: Date, required: true }
});

// Auto-delete expired OTPs after 10 minutes (optional index)
OTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OTP', OTPSchema);


