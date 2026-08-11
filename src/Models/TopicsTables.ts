import mongoose from "mongoose";

interface Row {
  mainTopic: string;
  supTopic: string;
  comments?: string;
  text_color: string;
  bg_color: string;
  created_at: Date;
}

interface Table {
  title: string;
  description: string;
  table_rows: Row[];
}

const RowSchema = new mongoose.Schema<Row>({
  mainTopic: {
    type: String,
    trim: true,
    required: [true, "الموضوع الرئيسي مطلوب"],
  },
  supTopic: {
    type: String,
    trim: true,
    required: [true, "الموضوع الفرعي مطلوب"],
  },
  comments: {
    type: String,
    trim: true,
  },
  text_color: {
    type: String,
    default: "#000000",
  },
  bg_color: {
    type: String,
    default: "#ffffff",
  },
  created_at: { type: Date, default: Date.now },
});

const TopicsTablesSchema = new mongoose.Schema<Table>(
  {
    title: {
      type: String,
      required: [true, "خانة العنوان لا يمكن ان تترك فارغة"],
      unique: true,
      trim: true,
      minLength: [3, "يجب ان يكون اكبر من 3 أحرف"],
      maxLength: [50, "يجب ان يكون اقل من 50 حرف"],
    },
    description: {
      type: String,
      required: [true, "خانة الوصف لا يمكن ان تترك فارغة"],
      trim: true,
    },
    table_rows: {
      type: [RowSchema],
      validate: {
        validator: function (rows: Row[]) {
          if (!rows || rows.length === 0) return true;

          // استخراج وتنظيف الموضوعات الفرعية (مع تجاهل المسافات وحالة الأحرف)
          const supTopics = rows
            .map((row) => row.supTopic?.trim().toLowerCase())
            .filter(Boolean);

          // التأكد من عدم وجود تكرار بداخل المصفوفة
          return new Set(supTopics).size === supTopics.length;
        },
        message: "لا يمكن تكرار الموضوع الفرعي (supTopic) داخل نفس الجدول",
      },
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// 🔒 حماية إضافية قبل الحفظ لتسجيل الخطأ بشكل واضح
TopicsTablesSchema.pre("save", function () {
  const rows = this.table_rows || [];
  const supTopics = rows
    .map((row: Row) => row.supTopic?.trim().toLowerCase())
    .filter(Boolean);

  const hasDuplicates = new Set(supTopics).size !== supTopics.length;

  if (hasDuplicates) {
    throw new Error("لا يمكن تكرار الموضوع الفرعي داخل نفس الجدول");
  }
});

const TopicsTables = mongoose.model<Table>("TopicsTables", TopicsTablesSchema);

export default TopicsTables;
