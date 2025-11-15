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
const MONGO_URL = process.env.MONGO_URL; // phải set trên Render
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY; // set trên Render
const FROM_EMAIL = process.env.FROM_EMAIL; // set trên Render (đã verify)

if (!MONGO_URL) {
  console.error("Missing MONGO_URL in env");
  process.exit(1);
}
if (!SENDGRID_API_KEY) {
  console.error("Missing SENDGRID_API_KEY in env");
  process.exit(1);
}
if (!FROM_EMAIL) {
  console.error("Missing FROM_EMAIL in env");
  process.exit(1);
}

sgMail.setApiKey(SENDGRID_API_KEY);

let db;
let otps;

async function initMongo() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(); // nếu MONGO_URL chứa database name, nó sẽ dùng db đó; nếu không, bạn có thể set .db("otpdb")
  otps = db.collection("otps");

  // TTL index: Mongo sẽ tự xóa documents khi expiresAt < now
  await otps.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  // index email + used to speed queries
  await otps.createIndex({ email: 1, used: 1 });
  console.log("Mongo connected and indexes ensured");
}

// Utility: tạo OTP 6 chữ số
function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Basic validation util
function isValidEmail(email) {
  return typeof email === "string" && /\S+@\S+\.\S+/.test(email);
}

// Rate limits (simple, DB-driven)
// - Không gửi lại trong 60s: kiểm tra last doc không used hoặc tất cả doc trong 60s
// - Giới hạn gửi trong 1 giờ: maxSendPerHour (ví dụ 10)
const MIN_RESEND_SECONDS = 60;
const MAX_PER_HOUR = 10;
const OTP_TTL_MINUTES = 5;

app.get("/", (req, res) => res.send("OTP Server Running!"));

// POST /send-otp
// body: { email }
app.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Email không hợp lệ" });
    }

    const now = new Date();

    // 1) kiểm tra resend trong MIN_RESEND_SECONDS
    const recent = await otps.findOne({
      email,
      createdAt: { $gte: new Date(now.getTime() - MIN_RESEND_SECONDS * 1000) }
    });

    if (recent) {
      return res.status(429).json({
        success: false,
        message: `Vui lòng chờ ${MIN_RESEND_SECONDS} giây trước khi gửi lại.`
      });
    }

    // 2) giới hạn trong 1 giờ
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const countLastHour = await otps.countDocuments({ email, createdAt: { $gte: hourAgo } });
    if (countLastHour >= MAX_PER_HOUR) {
      return res.status(429).json({
        success: false,
        message: `Quá nhiều yêu cầu. Vui lòng thử lại sau vài giờ.`
      });
    }

    // 3) tạo otp, lưu db
    const otp = genOtp();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000);
    const doc = {
      email,
      otp,
      used: false,
      createdAt: now,
      expiresAt
    };

    await otps.insertOne(doc);

    // 4) gửi email qua SendGrid
    const msg = {
      to: email,
      from: FROM_EMAIL,
      subject: "Mã OTP của bạn",
      text: `Mã OTP của bạn là: ${otp}. Hết hạn sau ${OTP_TTL_MINUTES} phút.`,
      html: `<p>Mã OTP của bạn là:</p><h2 style="letter-spacing:4px">${otp}</h2><p>Hết hạn sau ${OTP_TTL_MINUTES} phút.</p>`
    };

    await sgMail.send(msg);

    // Nếu dev, trả otp trong response để test (không làm vậy trên prod)
    const isDev = process.env.NODE_ENV !== "production";

    return res.json({
      success: true,
      message: "Đã gửi OTP",
      ...(isDev ? { otp } : {})
    });
  } catch (err) {
    console.error("send-otp error:", err?.message ?? err);
    return res.status(500).json({ success: false, message: "Lỗi server khi gửi OTP" });
  }
});

// POST /verify-otp
// body: { email, otp }
app.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!isValidEmail(email) || !otp || typeof otp !== "string") {
      return res.status(400).json({ success: false, message: "Dữ liệu không hợp lệ" });
    }

    const now = new Date();

    // tìm document chưa used và chưa expired
    const doc = await otps.findOne({
      email,
      otp,
      used: false,
      expiresAt: { $gte: now }
    });

    if (!doc) {
      return res.status(400).json({ success: false, message: "Mã OTP không đúng hoặc đã hết hạn" });
    }

    // đánh dấu used
    await otps.updateOne({ _id: doc._id }, { $set: { used: true, verifiedAt: new Date() } });

    return res.json({ success: true, message: "Xác minh thành công" });
  } catch (err) {
    console.error("verify-otp error:", err?.message ?? err);
    return res.status(500).json({ success: false, message: "Lỗi server khi xác minh OTP" });
  }
});

// Minimal health
app.get("/health", (req, res) => res.json({ ok: true }));

// Start after Mongo init
initMongo()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to init mongo:", err);
    process.exit(1);
  });
