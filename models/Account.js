const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
  mobile: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // required because registration sets it
  role: { type: String, enum: ['customer', 'rider', 'serviceProvider'], required: true },
  isVerified: { type: Boolean, default: true }, // since they register with password
  googleId: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Account', AccountSchema);