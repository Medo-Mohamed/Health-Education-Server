import { Schema, model, Document, Types } from "mongoose";

// 1. حالات دورة حياة الخطة
export const PlanStatus = {
  DRAFT: "draft", // مسودة (يعدل عليها الموظفون)
  PENDING_REVIEW: "pending_review", // قيد المراجعة (في انتظار المشرف)
  APPROVED: "approved", // معتمدة (تُحسب النسب بناءً عليها)
  REJECTED: "rejected", // مرفوضة/تطلب تعديل
  COMPLETED: "completed", // مكتملة بعد انتهاء تاريخها
} as const;

export type PlanStatus = (typeof PlanStatus)[keyof typeof PlanStatus];

// 2. نوع/موقع الفعالية المحدث
export const PlanLocationType = {
  INTERNAL_SEMINAR: "internal_seminar", // ندوة داخلية
  EXTERNAL_SEMINAR: "external_seminar", // ندوة خارجية
  GENERAL_CONSULTATION: "general_consultation", // مشورة عامة
  PUBLIC_MEETING: "public_meeting", // لقاء جماهيري
  CONVOY_SEMINARS: "convoy_seminars", // ندوات قوافل
} as const;

export type PlanLocationType =
  (typeof PlanLocationType)[keyof typeof PlanLocationType];

// واجهة التوزيع المستهدف للحضور
export interface ITargetAttendeeBreakdown {
  males: number;
  females: number;
  children: number;
}

export interface IPlacePlan extends Document {
  place_id: Types.ObjectId; // المكان المخطط له
  created_by: Types.ObjectId; // الموظف الذي أنشأ المسودة

  // البيانات الأساسية للخطة
  schedule_name: string; // اسم جدول العمل / الخطة التشغيلية
  main_topic: string; // الموضوع الرئيسي
  sub_topic: string; // الموضوع الفرعي
  target_seminars_count: number; // عدد الندوات المستهدفة (العداد المدموج)

  // موقع ونوع الفعالية المستهدف
  location_type: PlanLocationType;
  external_location_name?: string | null;

  // 📡 الوسائل والأنشطة الإعلامية
  media_outlets_count: number; // عدد استخدام وسائل إعلامية
  digital_media_activities_count: number; // عدد أنشطة إعلامية رقمية

  // الحضور المستهدف
  target_attendees: ITargetAttendeeBreakdown;
  target_total_attendees: number;

  instructor_info?: Types.ObjectId | null; // المحاضر المقترح

  // التاريخ المخطط
  planned_date: Date;

  // 🔄 إدارة الحالات والاعتماد (Workflow & Approval)
  status: PlanStatus;
  reviewed_by?: Types.ObjectId | null; // المشرف الذي راجع/اعتمد/دمج الخطة
  reviewed_at?: Date | null; // تاريخ المراجعة/الاعتماد
  rejection_reason?: string | null; // سبب الرفض/الملاحظات عند طلب التعديل

  // 🧩 سجل الدمج (Merge Tracking)
  merged_from_ids?: Types.ObjectId[]; // معرفات الخطط المسودة التي تم دمجها في هذه الخطة المعتمدة

  created_at: Date;
  updated_at: Date;
}

const TargetAttendeeBreakdownSchema = new Schema<ITargetAttendeeBreakdown>(
  {
    males: { type: Number, default: 0, min: 0 },
    females: { type: Number, default: 0, min: 0 },
    children: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const PlacePlanSchema = new Schema<IPlacePlan>(
  {
    place_id: {
      type: Schema.Types.ObjectId,
      ref: "Place",
      required: [true, "المكان إجباري"],
      index: true,
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "منشئ الخطة إجباري"],
      index: true,
    },
    schedule_name: {
      type: String,
      required: [true, "اسم جدول العمل إجباري"],
      trim: true,
    },
    main_topic: {
      type: String,
      required: [true, "الموضوع الرئيسي إجباري"],
      trim: true,
      index: true,
    },
    sub_topic: {
      type: String,
      required: [true, "الموضوع الفرعي إجباري"],
      trim: true,
    },
    target_seminars_count: {
      type: Number,
      default: 1,
      min: [1, "عدد الندوات المستهدفة يجب أن يكون 1 على الأقل"],
    },

    // 📍 تفاصيل موقع ونوع الفعالية المستهدف
    location_type: {
      type: String,
      enum: Object.values(PlanLocationType),
      default: PlanLocationType.INTERNAL_SEMINAR,
      required: [true, "نوع الفعالية إجباري"],
    },
    external_location_name: {
      type: String,
      trim: true,
      default: null,
      validate: [
        {
          validator: function (value: string | null) {
            const doc = this as IPlacePlan;
            if (
              doc.location_type === PlanLocationType.EXTERNAL_SEMINAR ||
              doc.location_type === PlanLocationType.PUBLIC_MEETING ||
              doc.location_type === PlanLocationType.CONVOY_SEMINARS
            ) {
              return typeof value === "string" && value.trim().length > 0;
            }
            return true;
          },
          message: "اسم المكان الخارجي إجباري عند اختيار ندوة خارجية.",
        },
      ],
    },

    // 📡 الوسائل والأنشطة الإعلامية
    media_outlets_count: {
      type: Number,
      default: 0,
      min: [0, "عدد الوسائل الإعلامية لا يمكن أن يكون بالسالب"],
    },
    digital_media_activities_count: {
      type: Number,
      default: 0,
      min: [0, "عدد الأنشطة الإعلامية الرقمية لا يمكن أن يكون بالسالب"],
    },

    // 👥 الحضور المستهدف
    target_attendees: {
      type: TargetAttendeeBreakdownSchema,
      required: true,
      default: () => ({ males: 0, females: 0, children: 0 }),
      validate: {
        validator: function (value: ITargetAttendeeBreakdown) {
          return (
            (value?.males || 0) +
              (value?.females || 0) +
              (value?.children || 0) >
            0
          );
        },
        message: "لابد أن يكون هناك إجمالي حضور مستهدف أكبر من صفر.",
      },
    },

    target_total_attendees: { type: Number, default: 0, index: true },

    // المحاضر المقترح
    instructor_info: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // 📅 التاريخ المحدد للندوة
    planned_date: {
      type: Date,
      required: [true, "تاريخ الندوة إجباري"],
      index: true,
    },

    // 🔄 حالة الخطة
    status: {
      type: String,
      enum: Object.values(PlanStatus),
      default: PlanStatus.DRAFT,
      required: true,
      index: true,
    },

    // 👨‍💼 بيانات المشرف والاعتماد
    reviewed_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewed_at: {
      type: Date,
      default: null,
    },
    rejection_reason: {
      type: String,
      trim: true,
      default: null,
    },

    // 🔀 تتبع عملية دمج خطط متعددة
    merged_from_ids: [
      {
        type: Schema.Types.ObjectId,
        ref: "PlacePlan",
      },
    ],
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// Indexes مركبة لتسريع الاستعلامات واستخرج التقارير والنسب
PlacePlanSchema.index({ place_id: 1, status: 1, planned_date: -1 });
PlacePlanSchema.index({ place_id: 1, main_topic: 1 });
PlacePlanSchema.index({ status: 1, created_by: 1 });

// Middleware للـ Pre-Save (تنظيف وحساب المجموع المستهدف)
PlacePlanSchema.pre("save", function (this: IPlacePlan) {
  // 1. حساب مجموع الحضور المستهدف تلقائياً
  if (this.target_attendees) {
    this.target_total_attendees =
      (this.target_attendees.males || 0) +
      (this.target_attendees.females || 0) +
      (this.target_attendees.children || 0);
  }

  // 2. تفريغ اسم المكان الخارجي إذا لم يكن نوع الفعالية ندوة خارجية
  if (
    this.location_type === PlanLocationType.INTERNAL_SEMINAR ||
    this.location_type === PlanLocationType.GENERAL_CONSULTATION
  ) {
    this.external_location_name = null;
  }
});

export const PlacePlan = model<IPlacePlan>("PlacePlan", PlacePlanSchema);
