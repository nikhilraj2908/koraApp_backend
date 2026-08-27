// controllers/washerAuthController.js
const Washer = require("../models/Washer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { notifyAdmins } = require("../utils/notification");

const generateToken = (id) =>
  jwt.sign({ id, role: "washer" }, process.env.JWT_SECRET, { expiresIn: "7d" });

// POST /api/washer/auth/register
// washerAuthController.js mein register function temporarily debug karo:
exports.register = async (req, res) => {
  try {
    const normalizedName = (req.body.name || req.body.fullName || '').trim();
    const normalizedPhone = (req.body.phone || req.body.mobile || '').replace(/\D/g, '');
    const normalizedEmail = (req.body.email || '').trim().toLowerCase();
    let services;

    try {
      services = Array.isArray(req.body.services)
        ? req.body.services
        : JSON.parse(req.body.services || '[]');
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid services selection' });
    }

    const shopPhoto = req.files?.shopPhoto?.[0];
    const aadhaarFront = req.files?.aadhaarFront?.[0];
    const aadhaarBack = req.files?.aadhaarBack?.[0];
    const profilePhoto = req.files?.profilePhoto?.[0];
    const requiredDetails = normalizedName && normalizedPhone.length === 10 && normalizedEmail
      && req.body.password && req.body.dob && req.body.gender && req.body.shopAddress;

    if (!requiredDetails) {
      return res.status(400).json({ success: false, message: 'All personal and shop details are required' });
    }
    if (!Array.isArray(services) || services.length === 0) {
      return res.status(400).json({ success: false, message: 'Select at least one washing service' });
    }
    if (!shopPhoto || !aadhaarFront || !aadhaarBack || !profilePhoto) {
      return res.status(400).json({ success: false, message: 'Shop photo, profile photo and both Aadhaar images are required' });
    }
    if (req.body.declarationsAccepted !== 'true' && req.body.declarationsAccepted !== true) {
      return res.status(400).json({ success: false, message: 'All declarations must be accepted' });
    }

    const exists = await Washer.findOne({
      $or: [{ phone: normalizedPhone }, { email: normalizedEmail }],
    });
    if (exists) {
      const message = exists.email === normalizedEmail
        ? 'Email address is already registered'
        : 'Phone number is already registered';
      return res.status(400).json({ success: false, message });
    }

    const washer = await Washer.create({
      name: normalizedName,
      phone: normalizedPhone,
      email: normalizedEmail,
      password: req.body.password,
      dob: new Date(req.body.dob),
      gender: req.body.gender,
      shopAddress: req.body.shopAddress.trim(),
      shopPhoto: `/uploads/${shopPhoto.filename}`,
      services,
      experience: Number(req.body.experience) || 0,
      aadhaarFront: `/uploads/${aadhaarFront.filename}`,
      aadhaarBack: `/uploads/${aadhaarBack.filename}`,
      profilePhoto: `/uploads/${profilePhoto.filename}`,
      declarationsAccepted: true,
      verificationStatus: 'pending',
      isVerified: false,
    });

    // Bell icon for admin/subadmin — never let a failure here block
    // washer registration itself.
    notifyAdmins({
      type: 'washer_signup',
      title: 'New washer signup',
      body: `${washer.name} submitted their profile for verification`,
      referenceId: washer._id,
      referenceModel: 'Washer',
    });

    res.status(201).json({
      success: true,
      message: 'Registration submitted for verification',
      washer: {
        id: washer._id,
        name: washer.name,
        phone: washer.phone,
        email: washer.email,
        verificationStatus: washer.verificationStatus,
      },
    });
  } catch (err) {
    console.log('Register error:', err.stack); // ← stack trace
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/washer/auth/login
exports.login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password)
      return res.status(400).json({ success: false, message: "All fields required" });

    const washer = await Washer.findOne({ phone });
    if (!washer)
      return res.status(404).json({ success: false, message: "Washer not found" });

    const isMatch = await bcrypt.compare(password, washer.password);
    if (!isMatch)
      return res.status(401).json({ success: false, message: "Invalid credentials" });

    const token = generateToken(washer._id);

    res.json({
      success: true,
      token,
      washer: { id: washer._id, name: washer.name, phone: washer.phone },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/washer/auth/me
exports.getMe = async (req, res) => {
  try {
    const washer = await Washer.findById(req.user.id).select("-password");
    res.json({ success: true, washer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/washer/auth/push-token
exports.savePushToken = async (req, res) => {
  try {
    await Washer.findByIdAndUpdate(req.user.id, { expoPushToken: req.body.expoPushToken });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};