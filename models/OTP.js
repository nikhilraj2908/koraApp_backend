const mongoose = require('mongoose');

const OTPSchema = new mongoose.Schema({
  contact: { 
    type: String, 
    required: true,
    index: true           // for faster lookups by contact
  },
  otp: { 
    type: String, 
    required: true 
  },
  purpose: { 
    type: String, 
    enum: ['login', 'reset'], 
    default: 'login' 
  },
  expiresAt: { 
    type: Date, 
    required: true 
  }
});

// Auto-delete expired OTPs (TTL index)
OTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OTP', OTPSchema);