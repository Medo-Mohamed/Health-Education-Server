import type { Request, Response, NextFunction } from "express";
import cloudinary from "../Config/cloudinary.ts";
import FileArchive from "../Models/FileArchive.ts";
import { Readable } from "node:stream";
export const uploadFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "يرجى اختيار ملف" });
    }

    // console.log(req.file);

    // إصلاح مشكلة ترميز أسماء الملفات باللغة العربية
    const correctedFileName = Buffer.from(
      req.file.originalname,
      "latin1",
    ).toString("utf8");

    // 1. تحديد أنواع الملفات المسموح بها (MIME Types)
    const allowedMimeTypes = [
      // الصور
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      // المستندات (PDF)
      "application/pdf",
      // ملفات الورد (Word)
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      // ملفات الإكسل (Excel)
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // ملفات البوربوينت (PowerPoint)
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      // الملفات المضغوطة
      "application/zip",
      "application/x-zip-compressed",
    ];

    // 2. التحقق من نوع الملف المرفوع
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        message:
          "نوع الملف غير مدعوم. المسموح به: صور، PDF، Word، Excel، PowerPoint فقط.",
      });
    }

    const isImage = req.file.mimetype.startsWith("image/");

    // 2. ضبط خيارات Cloudinary الصحيحة
    const cloudinaryOptions: any = {
      folder: "medical_archive",
      // الصور تأخذ "image"، والـ PDF والمستندات الأخرى تأخذ "raw" أو "auto"
      resource_type: isImage ? "image" : "raw",
      use_filename: true,
      unique_filename: true,
    };

    // 3. رفع الـ Buffer عبر Stream إلى Cloudinary
    const uploadFromBuffer = (buffer: Buffer): Promise<any> => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          cloudinaryOptions,
          (error, result) => {
            if (result) {
              resolve(result);
            } else {
              reject(error);
            }
          },
        );
        // ضخ البيانات المخزنة في الذاكرة (Buffer) إلى Stream
        Readable.from(buffer).pipe(stream);
      });
    };

    const result = await uploadFromBuffer(req.file.buffer);

    // 4. حفظ بيانات الملف في قاعدة البيانات
    const newFile = await FileArchive.create({
      fileName: correctedFileName,
      fileUrl: result.secure_url,
      publicId: result.public_id,
      fileType:
        (result.format || correctedFileName.split(".").pop()) ?? "unknown",
      fileSize: (req.file.size / (1024 * 1024)).toFixed(2) + " MB",
    });

    next();
  } catch (error: any) {
    console.error("Cloudinary Upload Error:", error.message || error);
    res.status(500).json({ message: error.message || "خطأ في رفع الملف" });
  }
};

export const getFiles = async (req: Request, res: Response) => {
  try {
    // 1. استخراج المعاملات من الرابط (Query Params)
    const page = parseInt(req.query.page as string) || 1;
    const search = (req.query.search as string) || ""; // نص البحث
    const limit = 10;
    const skip = (page - 1) * limit;

    // 2. بناء كائن الفلترة (Query Object)
    // نستخدم 'i' لجعل البحث غير حساس لحالة الأحرف (Case-insensitive)
    const query = search ? { fileName: { $regex: search, $options: "i" } } : {}; // إذا كان البحث فارغاً، نرسل كائن فارغ ليعيد الجميع

    // 3. تنفيذ الاستعلام مع الفلترة والتقسيم
    const files = await FileArchive.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // 4. حساب الإجمالي بناءً على نتائج البحث (مهم جداً للعد الصحيح)
    const totalFiles = await FileArchive.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        files,
        currentPage: page,
        totalPages: Math.ceil(totalFiles / limit),
        totalFiles,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      message: error.message || "حدث خطأ أثناء جلب الملفات",
    });
  }
};

export const deleteFile = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 1. البحث عن الملف في قاعدة البيانات
    const file = await FileArchive.findById(id);

    if (!file) {
      return res.status(404).json({ message: "الملف غير موجود" });
    }

    // 2. تحديد نوع resource_type الخاص بـ Cloudinary
    // الملفات المرفوعة كـ raw (مثل PDF والـ Word) تحتاج resource_type: "raw" للحذف
    const isImage = ["jpg", "jpeg", "png", "webp", "gif"].includes(
      file.fileType.toLowerCase(),
    );
    const resourceType = isImage ? "image" : "raw";

    // 3. حذف الملف من Cloudinary باستخدام publicId
    if (file.publicId) {
      await cloudinary.uploader.destroy(file.publicId, {
        resource_type: resourceType,
      });
    }

    // 4. حذف بيانات الملف من قاعدة البيانات
    await FileArchive.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "تم حذف الملف بنجاح",
    });
  } catch (error: any) {
    console.error("Cloudinary Delete Error:", error.message || error);
    return res.status(500).json({
      message: error.message || "حدث خطأ أثناء حذف الملف",
    });
  }
};
