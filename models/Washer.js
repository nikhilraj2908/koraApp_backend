const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const WasherSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    expoPushToken: { type: String, default: null },
    isAvailable: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
}, { timestamps: true });

WasherSchema.pre("save", function (next) {
    if (!this.isModified("password")) return next();
    const self = this;
    bcrypt.genSalt(10, function (err, salt) {
        if (err) return next(err);
        bcrypt.hash(self.password, salt, function (err, hash) {
            if (err) return next(err);
            self.password = hash;
            next();
        });
    });
});

module.exports = mongoose.model("Washer", WasherSchema);