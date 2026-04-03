const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  fullName: { type: String, required: true },
  dob: Date,
  email: String,
  profilePhoto: String,
  // ... any other customer specific fields
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Customer', CustomerSchema);