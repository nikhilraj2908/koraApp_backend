require('dotenv').config();
const twilio = require('twilio');
const OTP = require('../models/OTP');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const sendOtp = async (mobile, otp) => {
  const message = `Your KORA verification code is: ${otp}. Valid for 10 minutes.`;
  await client.messages.create({
    body: message,
    to: mobile,
    from: process.env.TWILIO_PHONE
  });
};

module.exports = sendOtp;