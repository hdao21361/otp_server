import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import sgMail from "@sendgrid/mail";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// LẤY API KEY TỪ RENDER ENVIRONMENT
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.get("/", (req, res) => {
  res.send("OTP Server Running!");
});

// Gửi OTP qua email
app.post("/send-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const msg = {
      to: email,
      from: process.env.FROM_EMAIL,
      subject: "Your OTP Code",
      text: `Your OTP is: ${otp}`,
      html: `<h2>Your OTP Code</h2><p style="font-size:22px">${otp}</p>`
    };

    await sgMail.send(msg);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PORT cho Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
