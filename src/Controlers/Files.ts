import type { Request, Response, NextFunction } from "express";
import cloudinary from "../Config/cloudinary.ts";
import FileArchive from "../Models/FileArchive.ts";
export const uploadFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.file) return res.status(400).json({ message: "يرجى اختيار ملف" });

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
      // الملفات المضغوطة (لأقصى مرونة)
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

    const isPDF = req.file.mimetype === "application/pdf";

    const cloudinaryOptions: any = {
      folder: "medical_archive",
      // لملفات PDF نستخدم image للسماح بالمعاينة، لبقية الملفات نستخدم auto
      resource_type: isPDF ? "image" : "auto",
      flags: "attachment:false", // لمنع إجبار التحميل
      secure: true,
    };

    // إذا كان PDF نحدد التنسيق لضمان وجود امتداد .pdf في الرابط
    if (isPDF) {
      cloudinaryOptions.format = "pdf";
    }

    const result = await cloudinary.uploader.upload(
      req.file.path,
      cloudinaryOptions,
    );

    const newFile = await FileArchive.create({
      fileName: correctedFileName,
      fileUrl: result.secure_url,
      publicId: result.public_id,
      fileType:
        (result.format || correctedFileName.split(".").pop()) ?? "unknown",
      fileSize: (req.file.size / (1024 * 1024)).toFixed(2) + " MB",
    });
    // const files = await FileArchive.find().sort({ createdAt: -1 });
    // res.status(201).json({
    //   message: "تم رفع الملف بنجاح",
    //   files, // إرسال الملفات بعد الإضافة الجديدة
    // });
    next();
  } catch (error: any) {
    console.error("Cloudinary Error:", error.message || error);
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
