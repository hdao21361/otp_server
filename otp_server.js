const express = require("express");
const sgMail = require("@sendgrid/mail");
const cors = require("cors");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// Gửi OTP qua email
app.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.json({ success: false, message: "Missing email" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const msg = {
      to: email,
      from: process.env.FROM_EMAIL,
      subject: "Mã OTP xác thực",
      text: `Mã OTP của bạn là: ${otp}`,
      html: `<h2>Mã OTP của bạn:</h2><h1>${otp}</h1>`,
    };

    await sgMail.send(msg);

    res.json({ success: true, otp });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server chạy trên port " + port));
