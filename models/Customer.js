const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  accountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
  },
  fullName: {
    type: String,
    required: true,
  },
  // Removed 'dob' as requested
  profilePhoto: String,
  addresses: [{
    label: String,
    addressLine: String,
    city: String,
    pincode: String,
    coordinates: [Number],
  }],
  defaultAddressId: mongoose.Schema.Types.ObjectId,
  phone: String,          // optional, separate from Account.mobile if needed
  expoPushToken: { type: String, default: null },
  notificationsEnabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Customer', CustomerSchema);