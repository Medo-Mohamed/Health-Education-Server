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
  governorate: string;
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
  _id: Types.ObjectId;
  username: string;
  password?: string; // جعلناه اختيارياً بسبب عملية الحذف في transform وللسماح باستخدامه بعد التشفير
  phone_numbers: string[];
  first_name: string;
  last_name: string;
  email?: string;
  role: "dev" | "user";
  avatar_url: string;
  friends: Types.ObjectId[];
  bio?: string;
  location: ILocation;
  forgetPasswordInfo: { otpCode: string; validTime: Date | null };
  social_links: ISocialLink[];
  preferences: IPreferences;
  stats: IStats;
  is_verified: boolean;
  last_login?: Date;
  created_at: Date; // مضافة بسبب timestamps
  updated_at: Date; // مضافة بسبب timestamps
  comparePassword(candidatePassword: string): Promise<boolean>;
  sendToClient(): Omit<
    IUser,
    | "password"
    | "__v"
    | "created_at"
    | "updated_at"
    | "forgetPasswordInfo"
    | "last_login"
    | "friends"
    | "social_links"
    | "preferences"
    | "stats"
    | "is_verified"
    | "location"
    | "role"
  >;
  sendToClientProfile(): Omit<
    IUser,
    | "password"
    | "__v"
    | "is_verified"
    | "forgetPasswordInfo"
    | "friends"
    | "preferences"
  >;
}

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: [true, "اسم المستخدم مطلوب ولا يمكن تركه فارغاً"],
      unique: true,
      trim: true,
      validate: {
        validator: (v: string) => /^[a-zA-Z0-9_]+$/.test(v),
        message:
          "اسم المستخدم يجب أن يحتوي فقط على حروف، أرقام، أو underscores (بدون مسافات أو رموز خاصة)",
      },
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
    first_name: {
      type: String,
      required: [true, "الاسم الاول مطلوب ولا يمكن تركه فارغاً"],
      trim: true,
    },
    last_name: {
      type: String,
      required: [true, "الاسم الأخير مطلوب ولا يمكن تركه فارغاً"],
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
      governorate: { type: String, default: "" },
      city: { type: String, default: "" },
      timezone: { type: String, default: "UTC+2" },
    },
    forgetPasswordInfo: {
      otpCode: {
        type: String,
        // لا نضع default هنا لأننا نريده فقط عند الطلب
      },
      validTime: {
        type: Date,
        // لا نضع default هنا أيضاً لتجنب خطأ توقيت السيرفر
      },
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

userSchema.methods.sendToClientProfile = function () {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.__v;
  delete userObject.is_verified;
  delete userObject.forgetPasswordInfo;
  delete userObject.friends;
  delete userObject.preferences;
  return userObject;
};

userSchema.methods.sendToClient = function () {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.__v;
  delete userObject.created_at;
  delete userObject.updated_at;
  delete userObject.forgetPasswordInfo;
  delete userObject.last_login;
  delete userObject.friends;
  delete userObject.social_links;
  delete userObject.preferences;
  delete userObject.stats;
  delete userObject.is_verified;
  delete userObject.location;
  delete userObject.role;

  return userObject;
};

const User = model<IUser>("User", userSchema);

export default User;
