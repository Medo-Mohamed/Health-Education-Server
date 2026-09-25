import mongoose from "mongoose";

export default async function dbConnect() {
  try {
    // 1. تصحيح الكلمة الإملائية + إعطاء الأولوية للرابط الأونلاين في Vercel
    const IS_DEVELOP = process.env.STATE === "develop";

    const databaseUrl = IS_DEVELOP
      ? process.env.LOCAL_DATABASE_URL
      : process.env.ONLINE_DATABASE_URL;

    // خيار احتياطي في حال عدم تعيين STATE بشكل صحيح
    const activeUrl =
      databaseUrl ||
      process.env.ONLINE_DATABASE_URL ||
      process.env.LOCAL_DATABASE_URL;

    if (!activeUrl) {
      console.error(
        "❌ Database URL is not configured in Environment Variables!",
      );
      return;
    }

    // 2. منع إعادة فتح الاتصال إذا كان مفتوحاً بالفعل (مهم جداً لـ Vercel Serverless)
    if (mongoose.connection.readyState >= 1) {
      return;
    }

    await mongoose.connect(activeUrl);
    console.log("✅ MongoDB Connected Successfully");
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error);
  }
}
