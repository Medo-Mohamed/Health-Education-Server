// models/UserPlaceAccess.ts
import { Schema, model, Document, Types } from "mongoose";
import {
  PlaceRole,
  PlacePermission,
  DEFAULT_ROLE_PERMISSIONS,
} from "../types/placeAccess";

// واجهة الصلاحية الاستثنائية المخصصة مع تاريخ الانتهاء
export interface ICustomPermission {
  permission: PlacePermission;
  granted_at: Date;
  expires_at?: Date | null; // null تعني أنها دائمة ولا تنتهي
}

export interface IUserPlaceAccess extends Document {
  user_id: Types.ObjectId;
  place_id: Types.ObjectId;
  role: PlaceRole;
  role_expires_at?: Date | null; // تاريخ انتهاء الدور كاملاً (اختياري)
  custom_permissions: ICustomPermission[]; // صلاحيات استثنائية زمنية/دائمة فوق الدور
  inherit_to_children: boolean; // هل تتمدد الصلاحية تلقائياً للأماكن الفرعية التابعة؟
  granted_by: Types.ObjectId; // المستخدم الذي منح هذه الصلاحية
  created_at: Date;
  updated_at: Date;
  getAllPermissions(): PlacePermission[]; // دالة تفلتر وترجع الصلاحيات السارية فقط
}

// 1. مخطط الصلاحيات الاستثنائية الفرعي (Subdocument Schema)
const CustomPermissionSchema = new Schema<ICustomPermission>(
  {
    permission: {
      type: String,
      enum: Object.values(PlacePermission),
      required: true,
    },
    granted_at: {
      type: Date,
      default: Date.now,
    },
    expires_at: {
      type: Date,
      default: null, // null تعني صلاحية دائمة
    },
  },
  { _id: false },
);

// 2. المخطط الرئيسي للوصول والصلاحيات
const UserPlaceAccessSchema = new Schema<IUserPlaceAccess>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "المستخدم إجباري"],
      index: true,
    },
    place_id: {
      type: Schema.Types.ObjectId,
      ref: "Place",
      required: [true, "المكان إجباري"],
      index: true,
    },
    role: {
      type: String,
      enum: Object.values(PlaceRole),
      default: PlaceRole.OPERATOR,
      required: true,
    },
    // تاريخ انتهاء الدور ككل على المكان
    role_expires_at: {
      type: Date,
      default: null,
    },
    // قائمة الصلاحيات الاستثنائية مع تاريخ الانتهاء لكل منها
    custom_permissions: [CustomPermissionSchema],
    inherit_to_children: {
      type: Boolean,
      default: true, // تفعيل وراثة الصلاحية للأماكن الأبناء افتراضياً
    },
    granted_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// 🔒 1. منع تكرار إعطاء دور لنفس المستخدم على نفس المكان
UserPlaceAccessSchema.index({ user_id: 1, place_id: 1 }, { unique: true });

// 🛠️ 2. دالة مساعدة متطورة لمعرفة الصلاحيات الفعالة (الغير منتهية الصلاحية)
UserPlaceAccessSchema.methods.getAllPermissions =
  function (): PlacePermission[] {
    const now = new Date();

    // أ. إذا كان الدور نفسه محدداً بتاريخ انتهاء وقد مضى تاريخه، يتم سحب كافة الصلاحيات
    if (this.role_expires_at && new Date(this.role_expires_at) < now) {
      return [];
    }

    // ب. جلب صلاحيات الدور الافتراضية
    const roleDefaultPermissions =
      DEFAULT_ROLE_PERMISSIONS[this.role as PlaceRole] || [];

    // ج. فلترة الصلاحيات الاستثنائية الصالحة فقط (التي لم تنتهِ بعد)
    const validCustomPermissions = (this.custom_permissions || [])
      .filter((cp: ICustomPermission) => {
        if (!cp.expires_at) return true; // صلاحية دائمة
        return new Date(cp.expires_at) > now; // صالحة إذا كان تاريخ الانتهاء أكبر من الآن
      })
      .map((cp: ICustomPermission) => cp.permission);

    // د. دمج صلاحيات الدور مع الصلاحيات الاستثنائية الفعالة دون تكرار
    return Array.from(
      new Set([...roleDefaultPermissions, ...validCustomPermissions]),
    );
  };

export const UserPlaceAccess = model<IUserPlaceAccess>(
  "UserPlaceAccess",
  UserPlaceAccessSchema,
);
