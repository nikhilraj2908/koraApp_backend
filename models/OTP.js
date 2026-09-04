const mongoose = require('mongoose');

const OTPSchema = new mongoose.Schema({
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    index: true,
  },
  contact: { 
    type: String, 
    trim: true,
    index: true           // for faster lookups by contact (email/phone)
  },
  newValue: {
    type: String,
    trim: true,
  },
  otp: { 
    type: String, 
    required: true 
  },
  purpose: { 
    type: String, 
    enum: ['login', 'reset', 'verify', 'email_change', 'mobile_change'], 
    default: 'login',
    required: true,
  },
  expiresAt: { 
    type: Date, 
    required: true 
  }
}, { timestamps: true });

// Auto-delete expired OTPs (TTL index)
OTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OTP', OTPSchema);