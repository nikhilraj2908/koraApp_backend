const Account = require('../models/Account');
const Customer = require('../models/Customer');
const Rider = require('../models/Rider');
const ServiceProvider = require('../models/ServiceProvider');
const OTP = require('../models/OTP');
const sendOtpUtil = require('../utils/sendOtp');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const generateToken = (accountId, role) => {
  return jwt.sign({ id: accountId, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

const createProfile = async (accountId, role, profileData) => {
  console.log('Creating profile for', role, profileData);
  switch (role) {
    case 'customer':
      return await Customer.create({ accountId, ...profileData });
    case 'rider':
      return await Rider.create({ accountId, ...profileData });
    case 'serviceProvider':
      return await ServiceProvider.create({ accountId, ...profileData });
    default:
      throw new Error('Invalid role');
  }
};

// ----------------------------------------------------------------------
// 1. REGISTRATION (username + password + mobile + profile)
// ----------------------------------------------------------------------


exports.register = async (req, res) => {
  console.log('1. Register endpoint hit'); // ✅
  try {
    console.log('2. Body:', req.body);
    const { username, password, mobile, role, ...profileData } = req.body;

    if (!username || !password || !mobile || !role) {
      console.log('3. Missing fields');
      return res.status(400).json({ error: 'Username, password, mobile and role are required' });
    }

    console.log('4. Checking existing username');
    const existingUsername = await Account.findOne({ username });
    if (existingUsername) {
      console.log('5. Username taken');
      return res.status(409).json({ error: 'Username already taken' });
    }

    console.log('6. Checking existing mobile');
    const existingMobile = await Account.findOne({ mobile });
    if (existingMobile) {
      console.log('7. Mobile taken');
      return res.status(409).json({ error: 'Mobile already registered' });
    }

    console.log('8. Hashing password');
    const hashedPassword = await bcrypt.hash(password, 10);

    console.log('9. Creating account');
    const account = await Account.create({
      username,
      mobile,
      password: hashedPassword,
      role,
      isVerified: true
    });

    console.log('10. Creating profile for role:', role);
    await createProfile(account._id, role, profileData);

    console.log('11. Generating token');
    const token = generateToken(account._id, role);

    console.log('12. Sending response');
    res.status(201).json({ token, role });
  } catch (err) {
    console.error('ERROR in register:', err);
    res.status(500).json({ error: err.message });
  }
};

// ----------------------------------------------------------------------
// 2. LOGIN WITH USERNAME + PASSWORD
// ----------------------------------------------------------------------
exports.loginWithUsername = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const account = await Account.findOne({ username });
    if (!account) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isMatch = await bcrypt.compare(password, account.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = generateToken(account._id, account.role);
    res.json({ token, role: account.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ----------------------------------------------------------------------
// 3. MOBILE + OTP LOGIN
// ----------------------------------------------------------------------
// Step A: Send OTP (only if mobile exists)
exports.sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ error: 'Mobile number required' });

    const account = await Account.findOne({ mobile });
    if (!account) {
      return res.status(404).json({ error: 'User not registered' });
    }

    await sendOtpUtil(mobile);
    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Step B: Verify OTP and login
exports.verifyOtp = async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    if (!mobile || !otp) {
      return res.status(400).json({ error: 'Mobile and OTP required' });
    }

    const otpRecord = await OTP.findOne({ mobile, otp });
    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const account = await Account.findOne({ mobile });
    if (!account) {
      return res.status(404).json({ error: 'User not registered' });
    }

    // Delete used OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    const token = generateToken(account._id, account.role);
    res.json({ token, role: account.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ----------------------------------------------------------------------
// 4. LOGOUT (optional)
// ----------------------------------------------------------------------
exports.logout = (req, res) => {
  res.json({ message: 'Logged out successfully' });
};