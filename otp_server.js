import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import sgMail from "@sendgrid/mail";
import { MongoClient } from "mongodb";

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL;

if (!MONGO_URL || !SENDGRID_API_KEY || !FROM_EMAIL) {
  console.error("❌ Missing env variables");
  process.exit(1);
}

sgMail.setApiKey(SENDGRID_API_KEY);

// === Mongo Collections ===
let otps;
let users;

async function initMongo() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();

  const db = client.db("otpdb");
  otps = db.collection("otps");
  users = db.collection("users");

  await otps.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await otps.createIndex({ email: 1, used: 1 });
  await users.createIndex({ email: 1 }, { unique: true });

  console.log("✅ Mongo connected + indexes OK");
}

// Configuration
const MIN_RESEND_SECONDS = 60;
const MAX_PER_HOUR = 10;
const OTP_TTL_MINUTES = 5;

function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isValidEmail(email) {
  return typeof email === "string" && /\S+@\S+\.\S+/.test(email);
}

app.get("/", (req, res) => res.send("OTP Server Running!"));

// SEND OTP
app.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Email không hợp lệ" });
    }

    const now = new Date();

    // check if user already has 2FA enabled
    const u = await users.findOne({ email });
    if (u && u.twoFA === true) {
      return res.status(400).json({ success: false, message: "2FA đã bật trước đó" });
    }

    // 1. resend limit
    const recent = await otps.findOne({
      email,
      createdAt: { $gte: new Date(now.getTime() - MIN_RESEND_SECONDS * 1000) }
    });
    if (recent) {
      return res.status(429).json({ success: false, message: `Vui lòng chờ ${MIN_RESEND_SECONDS} giây trước khi gửi lại.` });
    }

    // 2. hourly limit
    const hourAgo = new Date(now.getTime() - 3600 * 1000);
    const countLastHour = await otps.countDocuments({ email, createdAt: { $gte: hourAgo } });
    if (countLastHour >= MAX_PER_HOUR) {
      return res.status(429).json({ success: false, message: "Quá nhiều yêu cầu, thử lại sau 1 giờ." });
    }

    // generate and save OTP
    const otp = genOtp();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000);
    await otps.insertOne({ email, otp, used: false, createdAt: now, expiresAt });

    // send email
    await sgMail.send({
      to: email,
      from: FROM_EMAIL,
      subject: "Mã OTP của bạn",
      html: `<h2>${otp}</h2><p>Hết hạn sau ${OTP_TTL_MINUTES} phút.</p>`
    });

    const dev = process.env.NODE_ENV !== "production";
    return res.json({ success: true, message: "Đã gửi OTP", ...(dev ? { otp } : {}) });

  } catch (err) {
    console.error("send-otp error:", err);
    return res.status(500).json({ success: false, message: "Lỗi server khi gửi OTP" });
  }
});

// VERIFY OTP
app.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!isValidEmail(email) || !otp) {
      return res.status(400).json({ success: false, message: "Dữ liệu không hợp lệ" });
    }

    const now = new Date();

    // find OTP doc
    const doc = await otps.findOne({ email, otp, used: false, expiresAt: { $gte: now } });
    if (!doc) {
      return res.status(400).json({ success: false, message: "OTP không đúng hoặc đã hết hạn" });
    }

    // mark OTP used
    await otps.updateOne({ _id: doc._id }, { $set: { used: true, verifiedAt: now } });

    // update user record: enable 2FA
    await users.updateOne({ email }, { $set: { email, twoFA: true, method: "email", updatedAt: now } }, { upsert: true });

    return res.json({ success: true, message: "Xác minh thành công", twoFA: true });

  } catch (err) {
    console.error("verify-otp error:", err);
    return res.status(500).json({ success: false, message: "Lỗi server khi xác minh OTP" });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

initMongo().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server chạy port ${PORT}`));
});
