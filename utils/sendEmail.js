const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendEmailOtp = async (to, otp) => {
  console.log("Before sendMail");

  const info = await transporter.sendMail({
    from: `"Kora App" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Verify Email OTP",
    html: `<p>Your OTP is <b>${otp}</b></p>`,
  });

  console.log("After sendMail");
  console.log(info);

  return info;
};

module.exports = sendEmailOtp;