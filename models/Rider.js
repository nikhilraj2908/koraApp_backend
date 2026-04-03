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
  isVerified: { type: Boolean, default: false },
  totalEarnings: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// No 2dsphere index – removed
module.exports = mongoose.model('Rider', RiderSchema);