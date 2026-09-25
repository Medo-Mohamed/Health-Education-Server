import express from "express";
import env from "dotenv";
env.config();

export const app = express();

const IS_DEVELOP = process.env.STATE === "develop"; // 👈 تصحيح الخطأ الإملائي

if (!IS_DEVELOP) {
  const silent = () => {};
  console.log = silent;
  console.info = silent;
  console.warn = silent;
  console.debug = silent;
}

import "./Config/ListenConnection";
import cookieParser from "cookie-parser";
import session from "express-session";
import MongoStore from "connect-mongo";
import cors from "cors";
import corsOptions from "./Config/corsOptions";
import UsersRouter from "./routes/User/Users";
import passport from "passport";
import "./Config/passport-config";

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

// 👈 استخدام URL أونلاين مباشرة لـ MongoStore لضمان عدم حدوث Crash قبل الاتصال
const mongoUrl =
  process.env.ONLINE_DATABASE_URL || process.env.LOCAL_DATABASE_URL;

app.use(
  session({
    secret: (process.env.SECRET_SESSION_KEY as string) || "fallback_secret",
    saveUninitialized: false,
    resave: false,
    cookie: {
      maxAge: 1000 * 60 * 60,
      secure: !IS_DEVELOP, // يكون true في الإنتاج لـ HTTPS
      httpOnly: true,
      sameSite: IS_DEVELOP ? "lax" : "none", // 👈 "none" ضروري للـ Cross-Origin بين Vercel و Frontend
    },
    store: MongoStore.create({
      mongoUrl: mongoUrl,
      ttl: 14 * 24 * 60 * 60,
    }),
  }),
);

app.use(passport.initialize());
app.use(passport.session());
app.use("/uploads", express.static("uploads"));

app.use("/auth", UsersRouter);

app.get("/", (req, res) => {
  res.status(200).json({ message: "Health Education Server is Running!" });
});

// 👈 تصحيح مسار 404
app.all("*", (req, res) => {
  res.status(404).json({ message: "404 Resource not found" });
});

// تصدير التطبيق لـ Vercel Serverless
export default app;
