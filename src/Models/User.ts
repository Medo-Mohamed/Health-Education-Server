import { Schema, model, type Document, type Types } from "mongoose";
import validator from "validator";
// import isEmail from "validator/lib/isEmail.js";
// import isMobilePhone from "validator/lib/isMobilePhone.js";
import bcrypt from "bcrypt";

// 1. واجهة الروابط الاجتماعية
interface ISocialLink {
  platform: string;
  url: string;
}

// 2. واجهة الموقع الجغرافي
interface ILocation {
  country: string;
  city: string;
  timezone: string;
}

// 4. واجهة التفضيلات
interface IPreferences {
  theme: "light" | "dark";
  language: string;
  notifications_enabled: boolean;
}

// 5. واجهة الإحصائيات
interface IStats {
  posts_count: number;
  followers: number;
  following: number;
}

export interface IUser extends Document {
  username: string;
  password?: string; // جعلناه اختيارياً بسبب عملية الحذف في transform وللسماح باستخدامه بعد التشفير
  phone_numbers: string[];
  full_name: string;
  email?: string;
  role: "dev" | "user";
  avatar_url: string;
  friends: Types.ObjectId[];
  bio?: string;
  location: ILocation;
  social_links: ISocialLink[];
  preferences: IPreferences;
  stats: IStats;
  is_verified: boolean;
  last_login?: Date;
  created_at: Date; // مضافة بسبب timestamps
  updated_at: Date; // مضافة بسبب timestamps
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: [true, "اسم المستخدم مطلوب ولا يمكن تركه فارغاً"],
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "كلمة السر مطلوبة ولا يمكن تركه فارغاً"],
    },
    phone_numbers: {
      type: [
        {
          type: String,
          validate: {
            validator: (v: string) => validator.isMobilePhone(v, "ar-EG"),
            message: (props: any) => `${props.value} ليس رقم هاتف صحيح!`,
          },
        },
      ],
      validate: {
        validator: function (v: string[]) {
          // التأكد من وجود رقم واحد على الأقل وأن المصفوفة ليست فارغة
          return Array.isArray(v) && v.length > 0;
        },
        message: "يجب إضافة رقم هاتف واحد على الأقل عند التسجيل.",
      },
    },
    full_name: {
      type: String,
      required: [true, "الاسم بالكامل مطلوب ولا يمكن تركه فارغاً"],
      trim: true,
    },
    role: {
      type: String,
      enum: ["dev", "user"],
      default: "user",
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      // sparse تسمح بوجود قيم null متعددة دون اعتبارها تكراراً
      unique: true,
      sparse: true,
      validate: {
        // يجب إضافة هذا الشرط للتأكد من عدم فحص البريد إذا كان فارغاً
        validator: function (value: string) {
          if (!value) return true; // تخطي التحقق إذا كان الحقل فارغاً
          return validator.isEmail(value);
        },
        message: "يرجى إدخال بريد إلكتروني صحيح",
      },
    },
    avatar_url: { type: String, default: "" },
    friends: [
      {
        user: { type: Schema.Types.ObjectId, ref: "User" },
        added_at: { type: Date, default: Date.now },
      },
    ],
    bio: { type: String, default: "" },
    location: {
      country: { type: String, default: "" },
      city: { type: String, default: "" },
      timezone: { type: String, default: "UTC+2" },
    },

    social_links: [
      {
        platform: {
          type: String,
          trim: true,
          required: [
            function (this: any) {
              return !!this.url;
            },
            "يجب تحديد اسم المنصة (Platform) عند إضافة رابط",
          ],
        },
        url: {
          type: String,
          match: [/^https?:\/\/.+/, "الرجاء إدخال رابط صحيح"],
          required: [
            function (this: any) {
              return !!this.platform;
            },
            "يجب إضافة الرابط (URL) عند تحديد اسم المنصة",
          ],
        },
      },
    ],

    preferences: {
      theme: { type: String, enum: ["light", "dark"], default: "light" },
      language: { type: String, default: "ar" },
      notifications_enabled: { type: Boolean, default: true },
    },

    stats: {
      posts_count: { type: Number, default: 0 },
      followers: { type: Number, default: 0 },
      following: { type: Number, default: 0 },
    },

    is_verified: { type: Boolean, default: true },

    last_login: { type: Date },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.password;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

userSchema.pre<IUser>("save", async function () {
  const user = this;

  if (!user.isModified("password")) {
    return;
  }

  try {
    const salt = await bcrypt.genSalt(10);
    if (user.password) user.password = await bcrypt.hash(user.password, salt);
  } catch (err: any) {
    throw new Error(err);
  }
});

userSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = model<IUser>("User", userSchema);

export default User;
