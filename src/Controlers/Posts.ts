import express from "express";
const router = express.Router();
import sharp from "sharp";
import path from "path";
import fs from "fs";
import Post from "../Models/Post.ts"; // تأكد من المسار الصحيح
import type { IUser } from "../Models/User.ts";
import type { Request, Response } from "express";
import { fileURLToPath } from "url";
import { uploadBufferToCloudinary } from "../Config/cloudinary.ts";

// هذا هو الجزء السحري الذي يعوض نقص __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// إعداد التخزين المؤقت لـ Multer
export const createPost = async (req: Request, res: Response) => {
  try {
    let filePath: string | null = null; // سيحتوي على الـ Secure URL من Cloudinary
    let mediaType: "text" | "image" | "video" = "text";

    if (req.file) {
      // 1. التحقق من وجود الـ Buffer
      if (!req.file.buffer) {
        console.error(
          "خطأ: لم يتم العثور على بيانات الملف. تأكد من استخدام MemoryStorage في Multer.",
        );
        return res.status(400).json({ error: "فشل في معالجة الملف" });
      }

      if (req.file.mimetype.startsWith("image")) {
        // ضغط الصورة وتحويلها إلى WEBP في الذاكرة باستخدام Sharp
        const optimizedBuffer = await sharp(req.file.buffer)
          .webp({ quality: 80 })
          .toBuffer();

        // رفع buffer الصورة المضغوطة إلى Cloudinary
        const uploadResult = await uploadBufferToCloudinary(
          optimizedBuffer,
          "posts/images",
          "image",
        );

        filePath = uploadResult.secure_url; // حفظ رابط Cloudinary
        mediaType = "image";
      } else if (req.file.mimetype.startsWith("video")) {
        // رفع buffer الفيديو المباشر إلى Cloudinary
        const uploadResult = await uploadBufferToCloudinary(
          req.file.buffer,
          "posts/videos",
          "video",
        );

        filePath = uploadResult.secure_url; // حفظ رابط Cloudinary
        mediaType = "video";
      }
    }

    // 2. التحقق من وجود محتوى (نص أو ميديا)
    if (!req.body.content && !req.file) {
      return res.status(400).json({
        error: "لا يمكن نشر منشور فارغ، يرجى إضافة نص أو وسائط",
      });
    }

    // 3. حساب تاريخ انتهاء الصلاحية (Expiration Logic)
    const daysToAdd = Number(req.body.days) || 0;
    const hoursToAdd = Number(req.body.hours) || 0;

    let expiresAt: Date | null = null;

    if (daysToAdd > 0 || hoursToAdd > 0) {
      expiresAt = new Date();

      const maxLimit = new Date();
      maxLimit.setDate(maxLimit.getDate() + 30);

      expiresAt.setUTCDate(expiresAt.getUTCDate() + daysToAdd);
      expiresAt.setUTCHours(expiresAt.getUTCHours() + hoursToAdd);

      if (expiresAt > maxLimit) {
        expiresAt = maxLimit;
      }
    }

    // 4. إنشاء وحفظ المنشور في قاعدة البيانات
    const newPost = new Post({
      content: req.body.content || "",
      mediaPath: filePath, // رابط الصورة/الفيديو المباشر على Cloudinary
      mediaType: mediaType,
      expiresAt: expiresAt,
      ownerDocument: (req as any).user?._id,
      viewsCount: 0,
      likes: [],
    });

    await newPost.save();

    // 5. إرسال الاستجابة الناجحة
    return res.status(201).json({
      message: "تم نشر المنشور بنجاح",
      post: newPost,
    });
  } catch (error) {
    console.error("Error creating post:", error);
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
};

export const getAllPosts = async (req: Request, res: Response) => {
  try {
    const currentTime = new Date();

    // جلب قيم الترقيم من Query Params مع تعيين قيم افتراضية
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const skip = (page - 1) * limit;

    // شرط الفلترة للمنشورات غير المنتهية
    const filter = {
      $or: [{ expiresAt: null }, { expiresAt: { $gt: currentTime } }],
    };

    // جلب إجمالي عدد المنشورات وحساب عدد الصفحات
    const totalPosts = await Post.countDocuments(filter);
    const totalPages = Math.ceil(totalPosts / limit);

    // جلب المنشورات المحددة للصفحة الحالية
    const posts = await Post.find(filter)
      .populate("ownerDocument", "avatar_url first_name last_name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.status(200).json({
      message: "تم جلب المنشورات بنجاح",
      posts,
      pagination: {
        total: totalPosts,
        page,
        limit,
        totalPages,
      },
    });
  } catch (error: any) {
    console.error("Error fetching posts:", error);
    res.status(500).json({ error: error.message || "حدث خطأ داخلي" });
  }
};

// 2. جلب المنشورات وزيادة عداد المشاهدات (Read-Only Logic)
router.get("/all", async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });

    // زيادة العداد لكل المنشورات المعروضة (أو يمكنك عمل endpoint منفصل لكل منشور)
    const postIds = posts.map((p) => p._id);
    await Post.updateMany(
      { _id: { $in: postIds } },
      { $inc: { viewsCount: 1 } },
    );

    res.json(posts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. نظام الإعجاب (تفاعل محدود)
router.post("/:id/like", async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post)
      return res.status(404).send("المنشور غير موجود أو انتهت صلاحيته");

    // نتحقق إذا كان المستخدم مسجل (بافتراض وجود auth middleware)
    const userId = (req.user as IUser)?._id; // تأكد من نوع البيانات

    if (post.likes.includes(userId)) {
      post.likes.pull(userId); // إلغاء الإعجاب
    } else {
      post.likes.push(userId); // إضافة إعجاب
    }

    await post.save();
    res.json({ likesCount: post.likes.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
