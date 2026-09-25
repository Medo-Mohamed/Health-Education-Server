import express from "express";
import env from "dotenv";

if (process.env.NODE_ENV !== "production") {
  env.config();
}

export const app = express();

// 1. تفعيل الثقة في البروكسي (ضروري لـ Vercel لتشغيل الكوكيز عبر HTTPS)
app.set("trust proxy", 1);

const IS_DEVELOP = process.env.STATE === "develop";

import cookieParser from "cookie-parser";
import session from "express-session";
import MongoStore from "connect-mongo";
import cors from "cors";
import corsOptions from "./Config/corsOptions";
import UsersRouter from "./routes/User/Users";
import passport from "passport";
import "./Config/passport-config";
import "./Config/ListenConnection";

// 2. تطبيق خيارات CORS (يتكفل بالتعامل مع كافة الطلبات وطلبات Preflight تلقائياً)
app.use(cors(corsOptions));

app.use(cookieParser());
app.use(express.json());

console.log("Is Develop:", IS_DEVELOP);

const mongoUrl =
  process.env.ONLINE_DATABASE_URL || process.env.LOCAL_DATABASE_URL;

const isProduction = process.env.NODE_ENV === "production";

// 3. ضبط الجلسات لحفظ الكوكي
if (mongoUrl) {
  app.use(
    session({
      secret: (process.env.SECRET_SESSION_KEY as string) || "fallback_secret",
      saveUninitialized: false,
      resave: false,
      proxy: true,
      cookie: {
        maxAge: 1000 * 60 * 60 * 24, // يوم كامل
        secure: isProduction,
        httpOnly: true,
        sameSite: isProduction ? "none" : "lax",
      },
      store: MongoStore.create({
        mongoUrl: mongoUrl,
        ttl: 14 * 24 * 60 * 60,
      }),
    }),
  );
}

app.use(passport.initialize());
app.use(passport.session());
app.use("/uploads", express.static("uploads"));

app.use("/auth", UsersRouter);

app.get("/", (req, res) => {
  res.status(200).json({ message: "Health Education Server is Running!" });
});

// معالجة مسارات 404
app.use((req, res) => {
  res.status(404).json({ message: "404 Resource not found" });
});

// معالج الأخطاء الرئيسي
app.use((err: any, req: any, res: any, next: any) => {
  console.error("SERVER ERROR LOG:", err);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

export default app;
