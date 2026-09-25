import mongoose, { Types, Document } from "mongoose";
interface IPost extends Document {
  content?: string;
  mediaPath?: string | null;
  mediaType: "image" | "video" | "text";
  viewsCount: number;
  likes: Types.Array<Types.ObjectId>;
  createdAt: Date;
  expiresAt?: Date | null;
  ownerDocument?: mongoose.Schema.Types.ObjectId; // ربط المنشور بالمستخدم
}

const postSchema = new mongoose.Schema<IPost>({
  content: { type: String, trim: true },
  mediaPath: { type: String, default: null }, // مسار الملف على السيرفر
  mediaType: { type: String, enum: ["image", "video", "text"], required: true },
  viewsCount: { type: Number, default: 0 },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  ownerDocument: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    // index: { expires: "24h" }, // سيتم حذف السجل من القاعدة تلقائياً بعد 24 ساعة
  },
  expiresAt: {
    type: Date,
    // نجعل القيمة الافتراضية دالة تحسب تاريخ اليوم + 30 يوم
    default: () => {
      const date = new Date();
      date.setDate(date.getDate() + 30);
      return date;
    },
    // index: { expires: 0 }, // يحذف المستند فور حلول التاريخ الموجود في expiresAt
  },
});

// // "Middleware" لحذف الملف من السيرفر قبل حذف السجل من القاعدة
// postSchema.pre("deleteOne", { document: true, query: false }, function (next) {
//   // التأكد من الوصول للمسار الصحيح للملف
//   if (this.mediaPath) {
//     const filePath = path.join(__dirname, "..", this.mediaPath);
//     if (fs.existsSync(filePath))
//       fs.unlink(filePath, (err) => {
//         if (err) {
//           console.error("فشل حذف الملف الفيزيائي:", err);
//         } else {
//           console.log("تم حذف الملف بنجاح عند مسح السجل");
//         }
//       });
//   }
// });

const Post = mongoose.model<IPost>("Post", postSchema);
export default Post;
