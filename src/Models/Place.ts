import { Schema, model, Document, Types } from "mongoose";
import validator from "validator";

export interface IPlaceMetadata {
  photo_url?: string;
  description?: string;
  address_details?: string;
  phone_numbers?: string[]; // مصفوفة الأرقام المفحوصة
}

export interface IPlace extends Document {
  name: string;
  type: "administrative" | "operational" | "external_location";
  parent_id?: Types.ObjectId | null;
  ancestors: Types.ObjectId[];
  metadata?: IPlaceMetadata;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const PlaceSchema = new Schema<IPlace>(
  {
    name: {
      type: String,
      required: [true, "اسم المكان مطلوب"],
      trim: true,
    },
    type: {
      type: String,
      enum: ["administrative", "operational", "external_location"],
      required: [true, "نوع المكان مطلوب"],
      index: true,
    },
    parent_id: {
      type: Schema.Types.ObjectId,
      ref: "Place",
      default: null,
      index: true,
    },
    ancestors: [
      {
        type: Schema.Types.ObjectId,
        ref: "Place",
      },
    ],
    metadata: {
      photo_url: { type: String, default: null },
      description: { type: String, default: null },
      address_details: { type: String, default: null },

      // التعديل الجديد بفحص الأرقام المصرية ar-EG
      phone_numbers: {
        type: [
          {
            type: String,
            trim: true,
            validate: {
              validator: (v: string) => validator.isMobilePhone(v, "ar-EG"),
              message: (props: any) => `${props.value} ليس رقم هاتف صحيح!`,
            },
          },
        ],
        default: [],
      },
    },
    is_active: { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// الفهارس لسرعة الاستعلامات
PlaceSchema.index({ ancestors: 1 });
PlaceSchema.index({ ancestors: 1, type: 1 });

export const Place = model<IPlace>("Place", PlaceSchema);
