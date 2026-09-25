import express from "express";
export const app = express();
import env from "dotenv";
env.config();

/**
 * ❗ قاعدة الكونسول الوحيدة في المشروع كله:
 * لا يُظهر أي شيء في الطرفية إلا إذا كانت قيمة STATE في ملف البيئة .env
 * تساوي "develop" بالضبط.
 *
 * الفكرة: تُكتم - تلقائياً وفي كل الملفات (Controllers/Config/routes...) -
 * دوال console.log / console.info / console.warn / console.debug
 * عند غير التطوير، فلا يختلط سجلّ الطلبات على المطوّر/المسرح بأي ضجيج.
 *
 * ملاحظة هندسية متعمّدة:
 * console.error تُبقى شغّالة دائماً (لا تُكتم حتى في غير develop) —
 * لأن الأخطاء الحرجة (فشل اتصال، استثناءات، فشل عمليات خادم) يجب أن
 * تظهر في سجلّ الإنتاج دائماً؛ إخفاؤها يجعل تشخيص الأعطال مستحيلاً.
 * لو أردت كتمها تماماً أيضاً، يكفي تفعيل السطر المُعلّق أدناه.
 */
const IS_DEVELOP = process.env.STATE === "devolop";
if (!IS_DEVELOP) {
  const silent = () => {};
  console.log = silent;
  console.info = silent;
  console.warn = silent;
  console.debug = silent;
  // console.error = silent;
  // console.error = silent; // (اختياري: لكتم الأخطاء أيضاً في غير تطوير)
}

import "./Config/ListenConnection";
import cookieParser from "cookie-parser";
import session from "express-session";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";
import cors from "cors";
import corsOptions from "./Config/corsOptions";
import UsersRouter from "./routes/User/Users";
import passport from "passport";
import "./Config/passport-config";

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());
app.use(
  session({
    secret: process.env.SECRET_SESSION_KEY as string,
    saveUninitialized: false,
    resave: false,
    cookie: {
      maxAge: 1000 * 60 * 60,
      secure: IS_DEVELOP ? false : false, // لأنك على http
      httpOnly: true,
      sameSite: IS_DEVELOP ? "lax" : "lax", // 👈 ضروري جداً للسماح بتداول الكوكي بين منفذ 5173 و 5000
    },
    store: MongoStore.create({
      client: mongoose.connection.getClient(),
    }),
  }),
);

app.use(passport.initialize());
app.use(passport.session());
app.use("/uploads", express.static("uploads"));

app.use("/auth", UsersRouter);

app.all("*any", (req, res) => {
  res.status(404).json({ message: "404 Resource not found" });
});

// تصدير التطبيق كـ Default Export لإطار Vercel Serverless
export default app;
