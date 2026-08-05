const express = require('express');
const { enrollRider, getProfile, updateProfile } = require('../controllers/riderController');
const { riderProtect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const Account = require('../models/Account');
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken');
const router = express.Router();
const { emitOrderUpdate } = require('../socket/trackingSocket');
router.post('/enroll', upload.fields([
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'drivingLicense', maxCount: 1 },
  { name: 'rc', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 }
]), enrollRider);

// ── Assigned Orders ──────────────────────────────────────────
router.get('/orders/assigned', riderProtect, async (req, res) => {
  try {
    console.log('[Rider] Fetching assigned orders, user:', req.user?._id ?? req.rider?._id);

    const orders = await Order.find({
      status: { $in: ['rider_pickup_assigned', 'picked_up', 'rider_delivery_assigned', 'delivered'] }
    });

    console.log('[Rider] Found orders:', orders.length);
    res.json({ success: true, data: orders });
  } catch (err) {
    console.log('[Rider] Error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── Accept ───────────────────────────────────────────────────
router.post('/orders/:id/accept', riderProtect, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        $set: { riderStatus: 'accepted' },
        $push: { statusHistory: { status: 'rider_accepted', updatedAt: new Date() } }
      },
      { new: true });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Reject ───────────────────────────────────────────────────
router.post('/orders/:id/reject', riderProtect, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        $set: { riderStatus: 'rejected' },
        $push: { statusHistory: { status: 'rider_rejected', updatedAt: new Date() } }
      },
      { new: true });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/orders/:id/picked-up', riderProtect, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        $set: { status: 'picked_up', riderStatus: 'picked_up' },
        $push: { statusHistory: { status: 'picked_up', updatedAt: new Date() } }
      },
      { new: true, populate: [{ path: 'riderPickupId', select: 'name phone' }, { path: 'riderDeliveryId', select: 'name phone' }] }
    );
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // ✅ Customer tracking screen update karo
    emitOrderUpdate(order);

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Delivered ────────────────────────────────────────────────
router.post('/orders/:id/delivered', riderProtect, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        $set: { status: 'delivered', riderStatus: 'delivered' },
        $push: { statusHistory: { status: 'delivered', updatedAt: new Date() } }
      },
      { new: true, populate: [{ path: 'riderPickupId', select: 'name phone' }, { path: 'riderDeliveryId', select: 'name phone' }] }
    );
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // ✅ Customer tracking screen update karo
    emitOrderUpdate(order);

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// ── Register ─────────────────────────────────────────────────
router.post('/auth/register', upload.fields([
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'drivingLicense', maxCount: 1 },
  { name: 'rc', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 },
]), async (req, res) => {
  let account;
  try {
    const {
      fullName, mobile, email, password, dob, gender, permanentAddress,
      currentAddress, preferredLocation, emergencyContactName,
      emergencyContactMobile, vehicleType, vehicleRegNo,
    } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedMobile = (mobile || '').replace(/\D/g, '');
    const hasTwoWheeler = req.body.hasTwoWheeler === 'true' || req.body.hasTwoWheeler === true;
    const declarationsAccepted = req.body.declarationsAccepted === 'true' || req.body.declarationsAccepted === true;
    const aadhaarFront = req.files?.aadhaarFront?.[0];
    const aadhaarBack = req.files?.aadhaarBack?.[0];
    const drivingLicense = req.files?.drivingLicense?.[0];
    const rc = req.files?.rc?.[0];
    const profilePhoto = req.files?.profilePhoto?.[0];

    if (!fullName || normalizedMobile.length !== 10 || !normalizedEmail || !password || !dob || !gender || !permanentAddress || !currentAddress) {
      return res.status(400).json({ message: 'All required personal details must be provided' });
    }
    if (!aadhaarFront || !aadhaarBack || !profilePhoto) {
      return res.status(400).json({ message: 'Aadhaar front, Aadhaar back and profile photo are required' });
    }
    if (hasTwoWheeler && (!vehicleType || !vehicleRegNo || !drivingLicense || !rc)) {
      return res.status(400).json({ message: 'Vehicle details, driving license and RC are required' });
    }
    if (!declarationsAccepted) {
      return res.status(400).json({ message: 'All declarations must be accepted' });
    }

    const existingMobile = await Account.findOne({ mobile: normalizedMobile });
    if (existingMobile) {
      return res.status(400).json({ message: 'Mobile number is already registered' });
    }

    const existingEmail = await Account.findOne({ email: normalizedEmail });
    if (existingEmail) {
      return res.status(400).json({ message: 'Email address is already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    account = await Account.create({
      email: normalizedEmail,
      mobile: normalizedMobile,
      password: hashedPassword,
      role: 'rider',
    });

    const rider = await Rider.create({
      accountId: account._id,
      fullName,
      dob,
      gender,
      permanentAddress: permanentAddress.trim(),
      currentAddress: currentAddress.trim(),
      preparedLocation: preferredLocation ? { address: preferredLocation.trim() } : undefined,
      emergencyContact: {
        name: (emergencyContactName || '').trim(),
        mobile: (emergencyContactMobile || '').replace(/\D/g, ''),
      },
      hasTwoWheeler,
      vehicleType: hasTwoWheeler ? vehicleType : undefined,
      vehicleRegNo: hasTwoWheeler ? vehicleRegNo.trim().toUpperCase() : undefined,
      documents: {
        aadhaarFront: `/uploads/${aadhaarFront.filename}`,
        aadhaarBack: `/uploads/${aadhaarBack.filename}`,
        drivingLicense: drivingLicense ? `/uploads/${drivingLicense.filename}` : undefined,
        rc: rc ? `/uploads/${rc.filename}` : undefined,
        profilePhoto: `/uploads/${profilePhoto.filename}`,
      },
      declarationsAccepted: true,
      verificationStatus: 'pending',
      isVerified: false,
    });

    res.status(201).json({
      success: true,
      message: 'Rider registration submitted for verification',
      rider: { id: rider._id, verificationStatus: rider.verificationStatus },
    });
  } catch (err) {
    if (account?._id) await Account.deleteOne({ _id: account._id }).catch(() => undefined);
    console.log('Register error:', err);
    res.status(500).json({ message: err.message });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { mobile, password } = req.body;

    // Mobile se Account dhundo
    const account = await Account.findOne({ mobile }).select('+password');
    if (!account) return res.status(401).json({ message: 'Mobile number not found' });

    // Role check
    if (account.role !== 'rider') {
      return res.status(401).json({ message: 'This account is not a rider' });
    }

    const isMatch = await bcrypt.compare(password, account.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid password' });

    // Rider profile dhundo
    const rider = await Rider.findOne({ accountId: account._id });
    if (!rider) return res.status(401).json({ message: 'Rider profile not found' });

    const token = jwt.sign(
      { id: account._id, role: 'rider', riderId: rider._id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      rider: {
        _id: rider._id,
        id: rider._id,
        name: rider.fullName,
        mobile: account.mobile,
        email: account.email,
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});



router.get('/profile', riderProtect, restrictTo('rider'), getProfile);
router.put('/profile', riderProtect, restrictTo('rider'), updateProfile);

module.exports = router;
