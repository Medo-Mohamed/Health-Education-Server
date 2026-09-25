import { app } from "../server";
import mongoose from "mongoose";
import dbConnect from "./dbConnect";
import env from "dotenv";

env.config();

// 1. الاتصال المباشر بقاعدة البيانات
dbConnect();

// 2. تشغيل app.listen() للمحيط المحلي فقط (Local Development)
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 5000;

  // ننتظر فتح الاتصال فقط في التطوير المحلي
  mongoose.connection.once("open", () => {
    console.log("Connected to MongoDB successfully (Local)");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  });
}

// معالجة أخطاء الاتصال
mongoose.connection.on("error", (e) => {
  console.error("MongoDB Connection Error:", e);
});
