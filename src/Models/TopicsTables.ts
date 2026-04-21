import mongoose from "mongoose";

interface Row {
  mainTopic: string;
  supTopic: string;
  text_color: string;
  bg_color: string;
  created_at: Date;
}

interface Table {
  title: string;
  description: string;
  table_rows: Row[];
}

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
    table_rows: [
      {
        mainTopic: {
          type: String,
          trim: true,
          required: true, // يفضل أن يكون إجبارياً
        },
        supTopic: {
          type: String,
          trim: true,
          required: true,
        },
        comments: {
          type: String,
          trim: true,
        },
        text_color: {
          type: String,
          default: "#000000", // قيمة افتراضية سوداء
        },
        bg_color: {
          type: String,
          default: "#ffffff", // قيمة افتراضية بيضاء
        },
        created_at: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
    },
    toObject: {
      virtuals: true,
    },
  },
);

TopicsTablesSchema.pre("save", function () {
  const rows = this.table_rows;
  const supTopics = rows.map((row: Row) => row.supTopic).filter(Boolean); // استخراج العناوين غير الفارغة

  // مقارنة طول المصفوفة مع طول مجموعة القيم الفريدة (Set)
  const hasDuplicates = new Set(supTopics).size !== supTopics.length;

  if (hasDuplicates) {
    throw new Error("لا يمكن تكرار الموضوع الفرعي داخل نفس الجدول");
  }
});

const TopicsTables = mongoose.model<Table>("TopicsTables", TopicsTablesSchema);

export default TopicsTables;
