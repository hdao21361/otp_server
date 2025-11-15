import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sgMail from "@sendgrid/mail";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// SendGrid API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.get("/", (req, res) => {
  res.send("OTP Server Running!");
});

// OTP endpoint
app.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  const msg = {
    to: email,
    from: process.env.FROM_EMAIL,
    subject: "Your OTP Code",
    text: `Your OTP is: ${otp}`
  };

  try {
    await sgMail.send(msg);
    res.json({ success: true, otp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to send OTP" });
  }
});

// VERY IMPORTANT for Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
