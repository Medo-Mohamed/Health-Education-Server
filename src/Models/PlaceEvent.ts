import { Schema, model, Document, Types } from "mongoose";

// نوع/موقع الفعالية المحدث لتطابق سكيما الخطة
export const EventLocationType = {
  INTERNAL_SEMINAR: "internal_seminar", // ندوة داخلية
  EXTERNAL_SEMINAR: "external_seminar", // ندوة خارجية
  GENERAL_CONSULTATION: "general_consultation", // مشورة عامة
  PUBLIC_MEETING: "public_meeting", // لقاء جماهيري
  CONVOY_SEMINARS: "convoy_seminars", // ندوات قوافل
} as const;

export type EventLocationType =
  (typeof EventLocationType)[keyof typeof EventLocationType];

export interface IAttendeeBreakdown {
  males: number;
  females: number;
  children: number;
}

export interface IPlaceEvent extends Document {
  place_id: Types.ObjectId; // المكان المسؤول/المرجعي في النظام
  created_by: Types.ObjectId; // المستخدم الذي أضاف الندوة

  // البيانات الأساسية
  schedule_name: string; // اسم جدول العمل / الخطة التشغيلية
  main_topic: string; // الموضوع الرئيسي
  sub_topic: string; // الموضوع الفرعي
  seminars_count: number; // عدد الندوات

  // تحديد موقع/نوع انعقاد الفعالية
  location_type: EventLocationType; // نوع المكان/الأنشطة
  external_location_name?: string | null; // اسم المكان الخارجي (مطلوب إذا كان location_type = EXTERNAL_SEMINAR)

  // تفكيك الحضور
  attendees: IAttendeeBreakdown;
  total_attendees: number; // مجموع الحضور الفعلي

  instructor_info: Types.ObjectId; // القائم بالندوات (User ID)
  event_date: Date; // تاريخ الندوة

  created_at: Date;
  updated_at: Date;
}

const AttendeeBreakdownSchema = new Schema<IAttendeeBreakdown>(
  {
    males: { type: Number, default: 0, min: 0 },
    females: { type: Number, default: 0, min: 0 },
    children: { type: Number, default: 0, min: 0 },
  },
  { _id: false }, // منع إنشاء _id فرعي للحضور
);

const PlaceEventSchema = new Schema<IPlaceEvent>(
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
      required: [true, "منشئ الفعالية إجباري"],
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
    seminars_count: { type: Number, default: 1, min: 1 },

    // 📍 تفاصيل موقع الفعالية المحدثة
    location_type: {
      type: String,
      enum: Object.values(EventLocationType),
      default: EventLocationType.INTERNAL_SEMINAR,
      required: [true, "نوع المكان إجباري"],
    },
    external_location_name: {
      type: String,
      trim: true,
      default: null,
      sparse: true,
      validate: [
        {
          validator: function (value: string | null) {
            const doc = this as IPlaceEvent;
            // إذا كان المكان ندوة خارجية، يشترط أن يحتوي الاسم على نص غير فارغ
            if (
              doc.location_type === EventLocationType.EXTERNAL_SEMINAR ||
              doc.location_type === EventLocationType.PUBLIC_MEETING ||
              doc.location_type === EventLocationType.CONVOY_SEMINARS
            ) {
              return typeof value === "string" && value.trim().length > 0;
            }
            return true;
          },
          message: "اسم المكان الخارجي إجباري عند اختيار ندوة خارجية.",
        },
      ],
    },

    attendees: {
      type: AttendeeBreakdownSchema,
      required: true,
      default: () => ({ males: 0, females: 0, children: 0 }),
      validate: {
        validator: function (value: IAttendeeBreakdown) {
          return (
            (value?.males || 0) +
              (value?.females || 0) +
              (value?.children || 0) >
            0
          );
        },
        message: "لابد أن يكون هناك حضور في الندوة (أكبر من صفر).",
      },
    },

    total_attendees: { type: Number, default: 0, index: true },

    instructor_info: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "محاضر الفعالية إجباري"],
      index: true,
    },
    event_date: {
      type: Date,
      required: [true, "تاريخ الفعالية إجباري"],
      index: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// Indexes تسريع الاستعلامات واللوحات
PlaceEventSchema.index({ place_id: 1, event_date: -1 });
PlaceEventSchema.index({ place_id: 1, main_topic: 1 });
PlaceEventSchema.index({ place_id: 1, location_type: 1 });

// Middleware للـ Pre-Save (تنظيف وحساب)
PlaceEventSchema.pre("save", function (this: IPlaceEvent) {
  // 1. حساب المجموع الكلي للحضور تلقائياً
  if (this.attendees) {
    this.total_attendees =
      (this.attendees.males || 0) +
      (this.attendees.females || 0) +
      (this.attendees.children || 0);
  }

  if (
    this.location_type === EventLocationType.INTERNAL_SEMINAR ||
    this.location_type === EventLocationType.GENERAL_CONSULTATION
  ) {
    this.external_location_name = null;
  }
});

export const PlaceEvent = model<IPlaceEvent>("PlaceEvent", PlaceEventSchema);
