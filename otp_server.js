// otp_server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import sgMail from "@sendgrid/mail";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const FROM = process.env.FROM_EMAIL;

// In-memory store: { email: { otp, expiresAt, lastSentAt } }
const store = new Map();

function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

app.get("/", (req, res) => res.send("OTP Server Running!"));

// send-otp: tạo OTP, kiểm tra cooldown 60s, gửi email
app.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes("@")) return res.status(400).json({ success: false, message: "Invalid email" });

    const now = Date.now();
    const record = store.get(email);

    // cooldown 60s
    if (record && record.lastSentAt && now - record.lastSentAt < 60_000) {
      const wait = Math.ceil((60_000 - (now - record.lastSentAt)) / 1000);
      return res.status(429).json({ success: false, message: `Please wait ${wait}s before resending` });
    }

    const otp = genOtp();
    const expiresAt = now + 5 * 60_000; // 5 phút
    store.set(email, { otp, expiresAt, lastSentAt: now });

    const msg = {
      to: email,
      from: FROM,
      subject: "Mã OTP từ ứng dụng của bạn",
      text: `Mã OTP: ${otp} (hết hạn sau 5 phút)`,
      html: `<p>Mã OTP của bạn: <b style="font-size:20px">${otp}</b></p><p>Hết hạn sau 5 phút</p>`
    };

    await sgMail.send(msg);
    return res.json({ success: true, message: "OTP sent" }); // không trả otp ra client để bảo mật
  } catch (err) {
    console.error("send-otp error:", err?.message ?? err);
    return res.status(500).json({ success: false, message: "Send failed" });
  }
});

// verify-otp: check OTP hợp lệ và chưa hết hạn
app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ success: false, message: "Missing params" });

  const rec = store.get(email);
  if (!rec) return res.status(400).json({ success: false, message: "No OTP requested" });

  if (Date.now() > rec.expiresAt) {
    store.delete(email);
    return res.status(400).json({ success: false, message: "OTP expired" });
  }

  if (rec.otp !== String(otp)) return res.status(400).json({ success: false, message: "Invalid OTP" });

  // thành công: xóa record hoặc đánh dấu verified
  store.delete(email);
  return res.json({ success: true, message: "Verified" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
