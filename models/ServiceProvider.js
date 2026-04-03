const mongoose = require('mongoose');

const ServiceProviderSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  fullName: String,
  mobile: String,
  dob: Date,
  gender: String,
  permanentAddress: String,
  currentAddress: String,
  emergencyContact: { name: String, mobile: String },
  expertise: [{ type: String, enum: ['Washing', 'Iron', 'Dry clean'] }],
  shopCertificate: String,      // if dry clean
  shopPhoto: String,
  capacityPerDay: Number,       // approx pairs
  location: {                   // current address coordinates
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: [Number],
    address: String
  },
  rates: {
    // dynamic rates per product – we store as Map
    men: Map,
    women: Map,
    accessories: Map,
    homeLinen: Map,
    premiumDryClean: Map
  },
  isVerified: { type: Boolean, default: false },
  totalEarnings: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

ServiceProviderSchema.index({ location: '2dsphere' });
module.exports = mongoose.model('ServiceProvider', ServiceProviderSchema);