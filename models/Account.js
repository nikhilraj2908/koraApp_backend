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
    trim: true,
    // required: false   // now optional (users can add later)
    // NOTE: the unique index for this field is defined explicitly below
    // as a PARTIAL index, not via `unique`/`sparse` here. `sparse: true`
    // still enforces uniqueness across documents where mobile is
    // explicitly `null` (it only skips documents missing the field
    // entirely) — a partial index with $type: "string" is safer and
    // ignores both missing and null values.
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

AccountSchema.index(
  { mobile: 1 },
  {
    unique: true,
    partialFilterExpression: { mobile: { $type: 'string' } },
  }
);

// Ensure either password or googleId is present (optional validation)
// Ensure either password or googleId is present
AccountSchema.pre('save', function() {
  if (!this.password && !this.googleId) {
    throw new Error('Either password or googleId must be provided');
  }
});

module.exports = mongoose.model('Account', AccountSchema);