const Customer = require('../models/Customer');
const Account = require('../models/Account');
const OTP = require('../models/OTP');
const bcrypt = require('bcrypt');
const sendEmailOtp = require('../utils/sendEmail'); // adjust path
const sendSmsOtp = require('../utils/sendOtp');   // adjust path
const formatPhone = (phone) => {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) return '+91' + cleaned;      // India
  if (phone.startsWith('+')) return phone;
  return '+' + cleaned;
};
// Helper functions
const ok = (res, data, code = 200) => res.status(code).json({ success: true, data });
const fail = (res, msg, code = 500) => res.status(code).json({ success: false, message: msg });

// Generate 6-digit OTP
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

// ─── GET PROFILE (unchanged) ──────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const customer = await Customer.findOne({ accountId: req.user.id }).populate({
      path: "accountId",
      select: "mobile email role",
    });
    if (!customer) return fail(res, "Profile not found", 404);
    return ok(res, {
      _id: customer._id,
      fullName: customer.fullName,
      dob: customer.dob,
      profilePhoto: customer.profilePhoto,
      addresses: customer.addresses,
      defaultAddressId: customer.defaultAddressId,
      phone: customer.phone,
      mobile: customer.accountId?.mobile,
      email: customer.accountId?.email,
      role: customer.accountId?.role,
    });
  } catch (err) {
    return fail(res, err.message);
  }
};
// ─── UPDATE BASIC PROFILE (name, dob only) ────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    const allowed = ['fullName', 'dob', 'profilePhoto'];
    const updates = {};
    allowed.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });
    const customer = await Customer.findOneAndUpdate(
      { accountId: req.user.id },
      { $set: updates },
      { returnDocument: 'after', runValidators: true }
    );
    if (!customer) return fail(res, 'Profile not found', 404);
    return ok(res, customer);
  } catch (err) {
    return fail(res, err.message);
  }
};

// ─── SET INITIAL MOBILE (onboarding, unverified) ──────────────────────────
// Used right after Google sign-up/login, where we don't have a mobile
// number yet. Deliberately skips OTP verification — this is just so a
// rider can call the customer. Only writes Customer.phone (not
// Account.mobile), so it can't collide with Account's unique mobile index.
exports.setInitialMobile = async (req, res) => {
  try {
    let { mobile } = req.body;
    if (!mobile) return fail(res, 'Mobile number is required', 400);

    mobile = formatPhone(mobile.trim());

    const digitsOnly = mobile.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      return fail(res, 'Enter a valid mobile number', 400);
    }

    const customer = await Customer.findOneAndUpdate(
      { accountId: req.user.id },
      { $set: { phone: mobile } },
      { returnDocument: 'after', runValidators: true }
    );

    if (!customer) return fail(res, 'Profile not found', 404);

    return ok(res, { phone: customer.phone });
  } catch (err) {
    console.error('setInitialMobile error:', err);
    return fail(res, err.message);
  }
};

// ─── REQUEST EMAIL CHANGE OTP ────────────────────────────────────────────
exports.requestEmailOtp = async (req, res) => {
  try {
    const { newEmail } = req.body;
    if (!newEmail) return fail(res, 'New email is required', 400);

    // Check if email already exists
    const existingAccount = await Account.findOne({ email: newEmail.toLowerCase() });
    if (existingAccount) return fail(res, 'Email already registered', 409);

    // Delete any previous OTP for this user/purpose
    await OTP.deleteMany({ accountId: req.user.id, purpose: 'email_change' });

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await OTP.create({
      accountId: req.user.id,
      purpose: 'email_change',
      newValue: newEmail.toLowerCase(),
      otp,
      expiresAt,
    });

    // Send OTP via email
    await sendEmailOtp(newEmail, otp);

    return ok(res, { message: 'OTP sent to new email address' });
  } catch (err) {
    return fail(res, err.message);
  }
};

// ─── VERIFY EMAIL CHANGE OTP ────────────────────────────────────────────
exports.verifyEmailOtp = async (req, res) => {
  try {
    const { newEmail, otp } = req.body;
    if (!newEmail || !otp) return fail(res, 'New email and OTP required', 400);

    const record = await OTP.findOne({
      accountId: req.user.id,
      purpose: 'email_change',
      newValue: newEmail.toLowerCase(),
      otp,
      expiresAt: { $gt: new Date() },
    });
    if (!record) return fail(res, 'Invalid or expired OTP', 400);

    // Update email in Account
    const account = await Account.findById(req.user.id);
    account.email = newEmail.toLowerCase();
    await account.save();

    // Clean up used OTP
    await OTP.deleteOne({ _id: record._id });

    return ok(res, { email: account.email });
  } catch (err) {
    return fail(res, err.message);
  }
};

// ─── REQUEST MOBILE CHANGE OTP ───────────────────────────────────────────
exports.requestMobileOtp = async (req, res) => {
  try {
    let { newMobile } = req.body;                     // ✅ use let
    if (!newMobile) return fail(res, 'New mobile number required', 400);

    newMobile = formatPhone(newMobile);               // ✅ format here

    // Check if mobile already exists in Customer collection
    const existingCustomer = await Customer.findOne({ phone: newMobile });
    if (existingCustomer) return fail(res, 'Mobile number already registered', 409);

    // Delete any previous OTP for this purpose
    await OTP.deleteMany({ accountId: req.user.id, purpose: 'mobile_change' });

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OTP.create({
      accountId: req.user.id,
      purpose: 'mobile_change',
      newValue: newMobile,    // ✅ store formatted
      otp,
      expiresAt,
    });

    // Send OTP via SMS
    await sendSmsOtp(newMobile, otp);   // ✅ send formatted

    return ok(res, { message: 'OTP sent to new mobile number' });
  } catch (err) {
    console.error(err);                 // ✅ log for debugging
    return fail(res, err.message);
  }
};

// ─── VERIFY MOBILE CHANGE OTP ────────────────────────────────────────────
exports.verifyMobileOtp = async (req, res) => {
  try {
    let { newMobile, otp } = req.body;
    if (!newMobile || !otp) return fail(res, 'New mobile and OTP required', 400);
    newMobile = formatPhone(newMobile);   // ✅ format

    const record = await OTP.findOne({
      accountId: req.user.id,
      purpose: 'mobile_change',
      newValue: newMobile,
      otp,
      expiresAt: { $gt: new Date() },
    });
    if (!record) return fail(res, 'Invalid or expired OTP', 400);

    const customer = await Customer.findOne({ accountId: req.user.id });
    if (!customer) return fail(res, 'Profile not found', 404);

    customer.phone = newMobile;           // ✅ store formatted
    await customer.save();

    await OTP.deleteOne({ _id: record._id });
    return ok(res, { mobile: customer.phone });
  } catch (err) {
    return fail(res, err.message);
  }
};
// ... other existing address methods unchanged ...

// ─── POST /api/customers/addresses ──────────────────────────────────────────
// Add a new address. Body: { label, addressLine, city, pincode, coordinates }
exports.addAddress = async (req, res) => {
  try {
    const { label, addressLine, city, pincode, coordinates } = req.body;

    if (!addressLine || !city) {
      return fail(res, 'addressLine and city are required', 400);
    }

    const customer = await Customer.findOne({ accountId: req.user.id });
    if (!customer) return fail(res, 'Profile not found', 404);

    customer.addresses.push({ label, addressLine, city, pincode, coordinates });

    // If this is the first address, auto-set as default
    if (customer.addresses.length === 1) {
      customer.defaultAddressId = customer.addresses[0]._id;
    }

    await customer.save();
    return ok(res, customer.addresses, 201);
  } catch (err) {
    return fail(res, err.message);
  }
};

// ─── PUT /api/customers/addresses/:addressId ────────────────────────────────
// Edit an existing address.
exports.updateAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const { label, addressLine, city, pincode, coordinates } = req.body;

    const customer = await Customer.findOne({ accountId: req.user.id });
    if (!customer) return fail(res, 'Profile not found', 404);

    const addr = customer.addresses.id(addressId);
    if (!addr) return fail(res, 'Address not found', 404);

    if (label       !== undefined) addr.label       = label;
    if (addressLine !== undefined) addr.addressLine = addressLine;
    if (city        !== undefined) addr.city        = city;
    if (pincode     !== undefined) addr.pincode     = pincode;
    if (coordinates !== undefined) addr.coordinates = coordinates;

    await customer.save();
    return ok(res, customer.addresses);
  } catch (err) {
    return fail(res, err.message);
  }
};

// ─── DELETE /api/customers/addresses/:addressId ─────────────────────────────
// Remove an address. If it was default, clear defaultAddressId.
exports.deleteAddress = async (req, res) => {
  try {
    const { addressId } = req.params;

    const customer = await Customer.findOne({ accountId: req.user.id });
    if (!customer) return fail(res, 'Profile not found', 404);

    const addr = customer.addresses.id(addressId);
    if (!addr) return fail(res, 'Address not found', 404);

    addr.deleteOne();

    // If deleted address was the default, clear it
    if (customer.defaultAddressId?.toString() === addressId) {
      customer.defaultAddressId = undefined;
    }

    await customer.save();
    return ok(res, customer.addresses);
  } catch (err) {
    return fail(res, err.message);
  }
};

// ─── PUT /api/customers/addresses/:addressId/default ────────────────────────
// Mark an address as the default delivery address.
exports.setDefaultAddress = async (req, res) => {
  try {
    const { addressId } = req.params;

    const customer = await Customer.findOne({ accountId: req.user.id });
    if (!customer) return fail(res, 'Profile not found', 404);

    const addr = customer.addresses.id(addressId);
    if (!addr) return fail(res, 'Address not found', 404);

    customer.defaultAddressId = addr._id;
    await customer.save();

    return ok(res, { defaultAddressId: customer.defaultAddressId });
  } catch (err) {
    return fail(res, err.message);
  }
};