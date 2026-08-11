import express from "express";
const router = express.Router();
import sharp from "sharp";
import path from "path";
import fs from "fs";
import Post from "../Models/Post.ts"; // تأكد من المسار الصحيح
import type { IUser } from "../Models/User.ts";
import type { Request, Response } from "express";
import { fileURLToPath } from "url";

// هذا هو الجزء السحري الذي يعوض نقص __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// إعداد التخزين المؤقت لـ Multer

export const createPost = async (req: Request, res: Response) => {
  try {
    let filePath = null;
    let mediaType = "text";

    if (req.file) {
      // 1. التحقق من وجود الـ Buffer (الحل للمشكلة الحالية)
      if (!req.file.buffer) {
        console.error(
          "خطأ: لم يتم العثور على بيانات الملف. تأكد من استخدام MemoryStorage في Multer.",
        );
        return res.status(400).json({ error: "فشل في معالجة الملف" });
      }

      const fileName = `post-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const uploadDir = path.join(__dirname, "..", "..", "uploads", "posts");

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      if (req.file.mimetype.startsWith("image")) {
        const fullPath = path.join(uploadDir, `${fileName}.webp`);

        // استخدام Sharp مع الـ Buffer القادم من الذاكرة
        await sharp(req.file.buffer).webp({ quality: 80 }).toFile(fullPath);

        filePath = `uploads/posts/${fileName}.webp`;
        mediaType = "image";
      } else if (req.file.mimetype.startsWith("video")) {
        const extension = path.extname(req.file.originalname);
        const fullPath = path.join(uploadDir, `${fileName}${extension}`);

        // بالنسبة للفيديو، نستخدم الـ buffer أيضاً أو نحفظه مباشرة
        fs.writeFileSync(fullPath, req.file.buffer);
        filePath = `uploads/posts/${fileName}${extension}`;
        mediaType = "video";
      }
    }

    // 2. التحقق من وجود محتوى (نص أو ميديا) لضمان عدم نشر منشور فارغ
    if (!req.body.content && !req.file) {
      return res.status(400).json({
        error: "لا يمكن نشر منشور فارغ، يرجى إضافة نص أو وسائط",
      });
    }

    // 3. حساب تاريخ انتهاء الصلاحية (Expiration Logic)
    // نستلم المدة من الفرونت إند (days و hours)
    // const days = parseInt(req.body.days) || 0;
    // const hours = parseInt(req.body.hours) || 0;
    const daysToAdd = Number(req.body.days) || 0;
    const hoursToAdd = Number(req.body.hours) || 0;

    let expiresAt: Date | null = null;

    // إذا حدد المستخدم وقتاً، نقوم بحسابه
    if (daysToAdd > 0 || hoursToAdd > 0) {
      expiresAt = new Date();

      // تأكيد سقف الـ 30 يوماً كحد أقصى (لحماية السيرفر)
      const maxLimit = new Date();
      maxLimit.setDate(maxLimit.getDate() + 30);
      // إضافة الأيام
      expiresAt.setUTCDate(expiresAt.getUTCDate() + daysToAdd);

      // إضافة الساعات
      expiresAt.setUTCHours(expiresAt.getUTCHours() + hoursToAdd);

      if (expiresAt > maxLimit) {
        expiresAt = maxLimit;
      }
    }
    // 4. إنشاء وحفظ المنشور في قاعدة البيانات
    const newPost = new Post({
      content: req.body.content || "",
      mediaPath: filePath, // سيكون القيمة التي حسبناها (image/video) أو null
      mediaType: mediaType,
      expiresAt: expiresAt, // تاريخ الحذف التلقائي
      ownerDocument: (req as any).user?._id, // ربط المنشور بالمستخدم (تأكد من وجود middleware للمصادقة)
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

    const posts = await Post.find({
      $or: [{ expiresAt: null }, { expiresAt: { $gt: currentTime } }],
    })
      .populate("ownerDocument", "avatar_url first_name last_name") // جلب بيانات كاتب المنشور (الاسم والصورة فقط)
      .sort({ createdAt: -1 })
      .lean(); // عرض الأحدث أولاً

    res.status(200).json({ message: "تم جلب المنشورات بنجاح", posts });
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
