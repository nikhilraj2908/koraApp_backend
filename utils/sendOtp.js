require('dotenv').config();
const twilio = require('twilio');
const OTP = require('../models/OTP');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const sendOtp = async (mobile, purpose = 'login') => {
  const otp = generateOtp();
  const message = `Your KORA verification code is: ${otp}. Valid for 10 minutes.`;

  try {
    await client.messages.create({
      body: message,
      to: mobile,
      from: process.env.TWILIO_PHONE
    });

    await OTP.findOneAndUpdate(
      { mobile, purpose },   // include purpose in query
      { otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      { upsert: true }
    );

    console.log(`OTP sent to ${mobile} for ${purpose}: ${otp}`);
    return otp;
  } catch (error) {
    console.error('Twilio error:', error);
    throw new Error('Failed to send OTP');
  }
};

module.exports = sendOtp;