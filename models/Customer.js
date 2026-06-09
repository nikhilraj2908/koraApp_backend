const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  fullName: { type: String, required: true },
  dob: Date,
  email: String,
  profilePhoto: String,
  createdAt: { type: Date, default: Date.now },
  addresses: [{
    label: String,
    addressLine: String,
    city: String,
    pincode: String,
    coordinates: [Number]
  }],
  defaultAddressId: mongoose.Schema.Types.ObjectId,
  phone: String,
  expoPushToken: { type: String, default: null },  // ← andar aaya
});

module.exports = mongoose.model('Customer', CustomerSchema);