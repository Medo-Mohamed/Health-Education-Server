// middleware/upload.ts
import multer from "multer";

// التخزين المؤقت على القرص قبل الرفع للسحابة
const storage = multer.diskStorage({});

const fileFilter = (req: any, file: any, cb: any) => {
  // التحقق من نوع الملف (MIME type)
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("عذراً، يمكنك رفع الصور فقط!"), false);
  }
};

export const upload = multer({ storage, fileFilter });
