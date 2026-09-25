import cron from "node-cron";
import { v2 as cloudinary } from "cloudinary";
import Post from "../Models/Post"; // تأكد من مسار موديل المنشورات

/**
 * دالة مساعدة لاستخراج الـ public_id ونوع الميديا من رابط Cloudinary
 * مثال للرابط: https://res.cloudinary.com/demo/image/upload/v123456789/posts/images/sample.webp
 * الـ public_id سيكون: posts/images/sample
 */
const getCloudinaryPublicId = (url: string) => {
  try {
    const parts = url.split("/");
    const uploadIndex = parts.indexOf("upload");
    if (uploadIndex === -1) return null;

    // استخراج الأجزاء بعد كلمة "upload/" وبُعد التنسيق أو إصدار الملف v12345
    const pathParts = parts.slice(uploadIndex + 1);

    // إذا كان هناك رقم الإصدار (مثل v16234567)، نتخطاه
    if (pathParts[0]?.startsWith("v")) {
      pathParts.shift();
    }

    const fullPathWithExtension = pathParts.join("/"); // مثال: posts/images/sample.webp
    // حذف الامتداد (مثل .webp أو .mp4)
    const publicId = fullPathWithExtension.substring(
      0,
      fullPathWithExtension.lastIndexOf("."),
    );

    return publicId;
  } catch (error) {
    console.error("خطأ أثناء استخراج public_id:", error);
    return null;
  }
};

// تشغيل المهمة كل ساعة (0 * * * *)
cron.schedule("0 * * * *", async () => {
  try {
    // console.log("جاري البحث عن المنشورات المنتهية الصلاحية لتنظيفها...");
    const now = new Date();

    // 1. البحث عن المنشورات التي انتهت صلاحيتها
    const expiredPosts = await Post.find({
      expiresAt: { $ne: null, $lte: now },
    });

    if (expiredPosts.length === 0) {
      return;
    }

    // console.log(`تم العثور على ${expiredPosts.length} منشور منتهي الصلاحية.`);

    for (const post of expiredPosts) {
      // 2. حذف الملف من Cloudinary إذا كان موجوداً
      if (post.mediaPath && post.mediaPath.startsWith("http")) {
        const publicId = getCloudinaryPublicId(post.mediaPath);

        if (publicId) {
          // تحديد نوع الميديا (image أم video)
          const resourceType = post.mediaType === "video" ? "video" : "image";

          await cloudinary.uploader.destroy(publicId, {
            resource_type: resourceType,
          });
          // console.log(`تم حذف الملف من Cloudinary: ${publicId}`);
        }
      }

      // 3. حذف المنشور من قاعدة البيانات (MongoDB)
      await post.deleteOne();
      // console.log(`تم حذف المنشور من قاعدة البيانات ID: ${post._id}`);
    }
  } catch (error) {
    console.error("خطأ أثناء تنظيف المنشورات المنتهية:", error);
  }
});
