const mongoose = require('mongoose');

const RiderSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  fullName: { type: String, required: true },
  dob: { type: Date, required: true },
  gender: { type: String, enum: ['Male', 'Female', 'Other'], required: true },
  permanentAddress: String,
  currentAddress: String,
  preparedLocation: {
    type: { type: String, enum: ['Point'] },
    coordinates: { type: [Number], default: undefined },  // no default empty array
    address: String
  },
  hasTwoWheeler: { type: Boolean, default: false },
  vehicleType: { type: String, enum: ['Bike', 'Scooter', 'Cycle'] },
  vehicleRegNo: String,
  emergencyContact: {
    name: String,
    mobile: String
  },
  documents: {
    aadhaarFront: String,
    aadhaarBack: String,
    drivingLicense: String,
    rc: String,
    profilePhoto: String
  },
  declarationsAccepted: { type: Boolean, required: true, default: false },
  verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  isVerified: { type: Boolean, default: false },
  totalEarnings: { type: Number, default: 0 },

  // ── Dispatch system fields ──
  expoPushToken: { type: String, default: null },

  // Live GPS — updated continuously while the rider app is open/tracking
  // (see services/riderLocationService.js, Phase 2). Distinct from
  // `preparedLocation` above, which is a one-time onboarding address, not
  // a live-tracked position.
  currentLocation: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: undefined }, // [lng, lat]
  },
  locationUpdatedAt: { type: Date, default: null },

  // Rider has the app open and toggled "online" — a prerequisite for
  // receiving ride offers, separate from isAvailable (online but
  // mid-delivery = not available for a NEW offer).
  isOnline: { type: Boolean, default: false },
  isAvailable: { type: Boolean, default: true },

  createdAt: { type: Date, default: Date.now }
});

// Required for $near/$geoNear nearby-rider discovery queries.
RiderSchema.index({ currentLocation: "2dsphere" });
module.exports = mongoose.model('Rider', RiderSchema);
// No 2dsphere index – removed
// module.exports = mongoose.model('Rider', RiderSchema);
