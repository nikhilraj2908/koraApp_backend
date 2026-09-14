const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const WasherSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    dob: { type: Date, required: true },
    gender: { type: String, enum: ["Male", "Female", "Other"], required: true },
    password: { type: String, required: true },
    shopAddress: { type: String, required: true, trim: true },

    // GPS coordinates of the washer's shop — set once during registration
    // or profile update via PATCH /api/washer/auth/location. Used by the
    // dispatch system's $near query (washerRepository.js) to find the
    // closest available washer for each order group.
    shopLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        default: undefined, // no default — null until explicitly set
      },
    },

    shopPhoto: { type: String, required: true },
    services: [{ type: String, enum: ["Handwash", "Machine Wash", "Steam Iron", "Coal Iron"] }],
    experience: { type: Number, min: 0, default: 0 },
    aadhaarFront: { type: String, required: true },
    aadhaarBack: { type: String, required: true },
    profilePhoto: { type: String, required: true },
    declarationsAccepted: { type: Boolean, required: true, default: false },
    verificationStatus: { type: String, enum: ["pending", "verified", "rejected"], default: "pending" },
    expoPushToken: { type: String, default: null },
    isAvailable: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
}, { timestamps: true });

// Required for $near/$geoNear nearby-washer discovery queries.
WasherSchema.index({ shopLocation: "2dsphere" });

WasherSchema.pre("save", async function () {
    if (!this.isModified("password")) return;
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
    } catch (err) {
        throw err;
    }
});

module.exports = mongoose.model("Washer", WasherSchema);
