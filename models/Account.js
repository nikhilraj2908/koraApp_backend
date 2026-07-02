const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  mobile: {
    type: String,
    unique: true,
    sparse: true,        // allows multiple nulls but ensures uniqueness for non-null values
    trim: true,
    // required: false   // now optional (users can add later)
  },
  password: {
    type: String,
    // required: false   // optional – required only for email/password accounts
  },
  role: {
    type: String,
    enum: ['customer', 'rider', 'serviceProvider', 'admin'],
    required: true,
  },
  isVerified: {
    type: Boolean,
    default: false,      // email sign‑up must verify via OTP; Google users are set to true
  },
  // Google OAuth fields
  googleId: {
    type: String,
    unique: true,
    sparse: true,        // allows multiple nulls
  },
  // Email verification OTP (for sign‑up)
  emailVerificationOTP: {
    type: String,
    default: null,
  },
  emailVerificationOTPExpiry: {
    type: Date,
    default: null,
  },
  // Password reset OTP
  resetPasswordOTP: {
    type: String,
    default: null,
  },
  resetPasswordOTPExpiry: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Ensure either password or googleId is present (optional validation)
// Ensure either password or googleId is present
AccountSchema.pre('save', function() {
  if (!this.password && !this.googleId) {
    throw new Error('Either password or googleId must be provided');
  }
});

module.exports = mongoose.model('Account', AccountSchema);