import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";

// تحميل متغيرات البيئة من ملف .env
dotenv.config();

// ضبط الإعدادات
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME as string,
  api_key: process.env.CLOUDINARY_API_KEY as string,
  api_secret: process.env.CLOUDINARY_API_SECRET as string,
  secure: true, // لضمان استخدام بروتوكول https دائماً في الروابط الناتجة
});

export default cloudinary;
