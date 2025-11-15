import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import sgMail from "@sendgrid/mail";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Lưu OTP tạm trong RAM
const otpStore = {};

app.get("/", (req, res) => {
  res.send("OTP Server Running!");
});

// API gửi OTP
app.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) return res.status(400).json({ success: false, message: "Thiếu email" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    otpStore[email] = otp;  // Lưu OTP

    const msg = {
      to: email,
      from: process.env.FROM_EMAIL,
      subject: "Your OTP Code",
      html: `<h2>Your OTP Code</h2><p style="font-size:22px">${otp}</p>`,
    };

    await sgMail.send(msg);

    return res.json({
      success: true,
      message: "Đã gửi OTP",
      otp: otp, // ← gửi về để Flutter verify được
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Gửi OTP thất bại" });
  }
});

// API xác minh OTP
app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp)
    return res.status(400).json({ success: false, message: "Thiếu email hoặc OTP" });

  if (otpStore[email] === otp) {
    delete otpStore[email];
    return res.json({ success: true, message: "Xác minh thành công" });
  }

  return res.status(400).json({ success: false, message: "OTP sai hoặc hết hạn" });
});

// PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
