// models/Archive.ts
import mongoose from "mongoose";

const ArchiveSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true }, // الاسم الأصلي للملف
    fileUrl: { type: String, required: true }, // رابط Cloudinary
    publicId: { type: String, required: true }, // معرف الملف في Cloudinary (للحذف لاحقاً)
    fileType: { type: String, required: true }, // pdf, docx, png, etc.
    fileSize: { type: String }, // حجم الملف (مثلاً: 2MB)
    category: { type: String, default: "General" },
  },
  { timestamps: true },
); // سيقوم بإضافة createdAt و updatedAt تلقائياً

const FileArchive = mongoose.model("FileArchive", ArchiveSchema);

export default FileArchive;
