// models/UserPlaceAccess.ts
import { Schema, model, Document, Types } from "mongoose";
import {
  PlaceRole,
  PlacePermission,
  DEFAULT_ROLE_PERMISSIONS,
} from "../types/placeAccess.ts";

export interface IUserPlaceAccess extends Document {
  user_id: Types.ObjectId;
  place_id: Types.ObjectId;
  role: PlaceRole;
  custom_permissions: PlacePermission[]; // صلاحيات استثنائية إضافية فوق الدور
  inherit_to_children: boolean; // هل تتمدد الصلاحية تلقائياً للأماكن الفرعية التابعة؟
  granted_by: Types.ObjectId; // المستخدم الذي منح هذه الصلاحية
  created_at: Date;
  updated_at: Date;
  getAllPermissions(): PlacePermission[]; // دالة مساعدة لمعرفة كافة صلاحيات المستخدم الفعلية على المكان
}

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
    custom_permissions: [
      {
        type: String,
        enum: Object.values(PlacePermission),
      },
    ],
    inherit_to_children: {
      type: Boolean,
      default: true, // تفعيل وراثة الصلاحية للأماكن الابناء افتراضياً
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

// 🛠️ 2. دالة مساعدة (Instance Method) لمعرفة كافة صلاحيات المستخدم الفعلية على المكان
UserPlaceAccessSchema.methods.getAllPermissions =
  function (): PlacePermission[] {
    const roleDefaultPermissions =
      DEFAULT_ROLE_PERMISSIONS[this.role as PlaceRole] || [];
    // دمج صلاحيات الدور الافتراضية مع الصلاحيات الاستثنائية دون تكرار
    return Array.from(
      new Set([...roleDefaultPermissions, ...this.custom_permissions]),
    );
  };

export const UserPlaceAccess = model<IUserPlaceAccess>(
  "UserPlaceAccess",
  UserPlaceAccessSchema,
);
