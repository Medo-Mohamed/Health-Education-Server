import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import multer from "multer"; // أضف هذا السطر
// تحميل متغيرات البيئة من ملف .env
dotenv.config();

// ضبط الإعدادات
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME as string,
  api_key: process.env.CLOUDINARY_API_KEY as string,
  api_secret: process.env.CLOUDINARY_API_SECRET as string,
  secure: true, // لضمان استخدام بروتوكول https دائماً في الروابط الناتجة
});

const storage = multer.memoryStorage(); // استخدام التخزين في الذاكرة لسهولة التعامل مع الملفات قبل رفعها إلى Cloudinary

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // حد أقصى 10 ميجا
});
export default cloudinary;
