const Account = require('../models/Account');
const Customer = require('../models/Customer');
const Rider = require('../models/Rider');
const ServiceProvider = require('../models/ServiceProvider');
const OTP = require('../models/OTP');
const sendOtpSms = require('../utils/sendOtp');   // kept if needed elsewhere
const sendEmailOtp = require('../utils/sendEmail');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const jwksClient = require('jwks-rsa');

// ─── helpers ───────────────────────────────────────────────
const generateToken = (accountId, role) => {
  return jwt.sign({ id: accountId, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// ─── Auth0 PKCE helpers (Native app type — no client secret) ─
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;

const jwkClient = jwksClient({
  jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
});

function getSigningKey(kid) {
  return new Promise((resolve, reject) => {
    jwkClient.getSigningKey(kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

async function verifyAuth0IdToken(idToken) {
  const decodedHeader = jwt.decode(idToken, { complete: true });
  if (!decodedHeader) throw new Error('Invalid ID token');

  const publicKey = await getSigningKey(decodedHeader.header.kid);

  return jwt.verify(idToken, publicKey, {
    algorithms: ['RS256'],
    audience: AUTH0_CLIENT_ID,
    issuer: `https://${AUTH0_DOMAIN}/`,
  });
}

const normalizeMobile = (mobile) => String(mobile).replace(/\D/g, '').slice(-10);

const createProfile = async (accountId, role, profileData) => {
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

// ─── 1. REGISTER (email, mobile, password, fullName, role) ───
exports.register = async (req, res) => {
  try {
    const { email, mobile, password, role, ...profileData } = req.body;

    if (!email || !mobile || !password || !role) {
      return res.status(400).json({ error: 'Email, mobile, password and role are required' });
    }
    if (!profileData.fullName) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    const existingEmail = await Account.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const normalizedMobile = normalizeMobile(mobile);
    const existingMobile = await Account.findOne({ mobile: normalizedMobile });
    if (existingMobile) {
      return res.status(409).json({ error: 'Mobile already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const account = await Account.create({
      email: email.toLowerCase(),
      mobile: normalizedMobile,
      password: hashedPassword,
      role,
      isVerified: false,
    });

    await createProfile(account._id, role, profileData);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OTP.findOneAndUpdate(
      { contact: account.email, purpose: 'verify' },
      { otp, expiresAt },
      { upsert: true, returnDocument: 'after' }
    );

    // ✅ Respond immediately — don't await the email
    res.status(201).json({
      message: 'Registration successful. Please verify your email with the OTP sent.',
      email: account.email,
    });

    // ✅ Send email AFTER responding — fire and forget
    sendEmailOtp(account.email, otp).catch(err =>
      console.error('[register] Failed to send OTP email:', err)
    );

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ─── 2. VERIFY EMAIL OTP ────────────────────────────────────
exports.verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const otpRecord = await OTP.findOne({ contact: email.toLowerCase(), otp, purpose: 'verify' });
    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Mark account as verified
    const account = await Account.findOne({ email: email.toLowerCase() });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    account.isVerified = true;
    await account.save();

    // Delete used OTP
    await OTP.deleteOne({ _id: otpRecord._id });

    // Optionally, you can auto‑login here by issuing a token
    // const token = generateToken(account._id, account.role);
    // res.json({ token, role: account.role });

    res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ─── 3. RESEND VERIFICATION OTP ────────────────────────────
exports.resendVerificationOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const account = await Account.findOne({ email: email.toLowerCase() });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    if (account.isVerified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OTP.findOneAndUpdate(
      { contact: account.email, purpose: 'verify' },
      { otp, expiresAt },
      { upsert: true, returnDocument: 'after' }
    );

    await sendEmailOtp(account.email, otp);

    res.json({ message: 'OTP resent to your email' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ─── 4. LOGIN (email or mobile + password) ──────────────────
exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/mobile and password required' });
    }

    let account;
    const isEmail = identifier.includes('@');

    if (isEmail) {
      account = await Account.findOne({ email: identifier.toLowerCase() });
    } else {
      const normalizedIdentifier = normalizeMobile(identifier);
      account = await Account.findOne({ mobile: normalizedIdentifier });
      // try full digits if not found
      if (!account && normalizedIdentifier.length >= 10) {
        account = await Account.findOne({ mobile: normalizedIdentifier.slice(-10) });
      }
    }

    if (!account) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 🔒 Check if account is verified
    if (!account.isVerified) {
      return res.status(403).json({
        error: 'Email not verified. Please verify your email first.',
        email: account.email,
      });
    }

    const isMatch = await bcrypt.compare(password, account.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(account._id, account.role);
    res.json({ token, role: account.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ─── 5. GOOGLE AUTH (sign‑up / login) — Authorization Code + PKCE ──
exports.googleAuth = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: "Google token missing" });
    }

    // verify token from Auth0
    const claims = await verifyAuth0IdToken(idToken);

    const email = claims.email;
    const name = claims.name;
    const picture = claims.picture;
    const googleId = claims.sub;

    if (!email) {
      return res.status(400).json({ message: "No email from Google" });
    }

    // STEP 1: find user
    let user = await Account.findOne({ email });

    // STEP 2: if not exist → create (SIGNUP)
    if (!user) {
      user = await Account.create({
        email,
        googleId,
        role: "customer",
        isVerified: true,
        password: null,
      });

      await createProfile(user._id, "customer", {
        fullName: name || "Google User",
        profilePhoto: picture || "",
      });
    }

    // STEP 3: login (same flow for signup + login)
    const token = generateToken(user._id, user.role);

    return res.json({
      token,
      role: user.role,
      user,
    });
  } catch (err) {
    console.error("Google Auth Error:", err);
    res.status(500).json({ message: "Google login failed" });
  }
};

// ─── 6. FORGOT PASSWORD (only email) ──────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;   // only email now
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const account = await Account.findOne({ email: email.toLowerCase() });
    if (!account) {
      return res.status(404).json({ error: 'No account found with this email' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OTP.findOneAndUpdate(
      { contact: account.email, purpose: 'reset' },
      { otp, expiresAt },
      { upsert: true, returnDocument: 'after' }
    );

    await sendEmailOtp(account.email, otp);

    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ─── 7. VERIFY RESET OTP ──────────────────────────────────
exports.verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;   // now email only
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP required' });
    }

    const otpRecord = await OTP.findOne({ contact: email.toLowerCase(), otp, purpose: 'reset' });
    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    await OTP.deleteOne({ _id: otpRecord._id });

    // Generate short-lived reset token
    const resetToken = jwt.sign(
      { email: email.toLowerCase(), purpose: 'reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({ resetToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ─── 8. RESET PASSWORD ────────────────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: 'Reset token and new password required' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired reset token' });
    }

    if (decoded.purpose !== 'reset') {
      return res.status(401).json({ error: 'Invalid token purpose' });
    }

    const { email } = decoded;
    const account = await Account.findOne({ email });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    account.password = hashedPassword;
    await account.save();

    res.json({ message: 'Password reset successful. You can now log in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ─── 9. LOGOUT ─────────────────────────────────────────────
exports.logout = (req, res) => {
  res.json({ message: 'Logged out successfully' });
};