const OTP = require('../models/OTP');
const crypto = require('crypto');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendOtp = async (mobile) => {
  const otp = generateOtp();
  // store in DB, expire in 10 minutes
  await OTP.findOneAndUpdate(
    { mobile },
    { otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    { upsert: true }
  );
  // In production use Twilio
  console.log(`OTP for ${mobile}: ${otp}`);
  // await twilioClient.messages.create({ body: `KORA OTP: ${otp}`, to: mobile, from: process.env.TWILIO_PHONE });
  return otp;
};

module.exports = sendOtp;