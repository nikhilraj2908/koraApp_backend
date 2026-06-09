// controllers/washerAuthController.js
const Washer = require("../models/Washer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const generateToken = (id) =>
  jwt.sign({ id, role: "washer" }, process.env.JWT_SECRET, { expiresIn: "7d" });

// POST /api/washer/auth/register
exports.register = async (req, res) => {
  try {
    const { name, phone, password } = req.body;

    if (!name || !phone || !password)
      return res.status(400).json({ success: false, message: "All fields required" });

    const exists = await Washer.findOne({ phone });
    if (exists)
      return res.status(400).json({ success: false, message: "Phone already registered" });

    const washer = await Washer.create({ name, phone, password });

    const token = generateToken(washer._id);

    res.status(201).json({
      success: true,
      message: "Registered successfully",
      token,
      washer: { id: washer._id, name: washer.name, phone: washer.phone },
    });
  } catch (err) {
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