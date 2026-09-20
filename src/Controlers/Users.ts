import type { Request, Response, NextFunction } from "express";
import User, { type IUser } from "../Models/User.ts";
import passport from "passport";
import { sendBrevoEmail } from "../Config/emailService.ts";
import jwt from "jsonwebtoken";
import cloudinary from "../Config/cloudinary.ts";
import fs from "fs";
import Follow from "../Models/Follow.ts";
import mongoose, { Types } from "mongoose";
export const createUsers = async (request: Request, response: Response) => {
  // console.log("Registering user with data:", request.body); // إضافة هذا السطر لتتبع البيانات المستلمة
  try {
    const {
      username,
      password,
      phone_numbers,
      first_name,
      last_name,
      email,
      location: { governorate, city, timezone },
    } = request.body;
    const newUser = new User({
      username,
      password,
      phone_numbers,
      first_name,
      last_name,
      email,
      location: { governorate, city, timezone },
    });
    await newUser.save();
    // console.log(newUser);
    response.status(201).json(newUser.sendToClient());
  } catch (error: any) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0] as string;
      const value = error.keyValue[field];

      // قاموس لترجمة أسماء الحقول للعربية
      const fieldNames: { [key: string]: string } = {
        username: "اسم المستخدم",
        email: "البريد الإلكتروني",
        phone_numbers: "رقم الهاتف",
      };

      return response.status(400).json({
        [field]: `عذراً، ${fieldNames[field] || field} مسجل لدينا بالفعل.`,
      });
    }
    const errorMsg: string = error.message;
    // console.log(errorMsg.split(","));
    if (errorMsg.startsWith("User validation failed:")) {
      const retMsg: any = {};
      errorMsg
        .slice(errorMsg.indexOf(":") + 1)
        .split(",")
        .forEach((str) => {
          const item = str.split(":") as [string, string];
          retMsg[item[0]?.trim()] = item[1]?.trim();
        });
      return response.status(400).json(retMsg);
    }
    response.status(401).json(error.message);
  }
};

export const login = (req: Request, res: Response, next: NextFunction) => {
  const { rememberMe } = req.body; // استخراج القيمة من الطلب
  passport.authenticate("local", (err: any, user: IUser, info: any) => {
    if (err) return res.status(401).json({ message: err.message });
    // if (!user) return res.status(400).json({ message: info.message });
    req.logIn(user, async (err) => {
      if (err) return res.status(500).json({ message: "حدث خطأ في السيرفر" });
      if (rememberMe) {
        // اجعل الكوكي يستمر لمدة 30 يوم (بالملي ثانية)
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        req.session.cookie.maxAge = thirtyDays;
      } else {
        // إذا لم يختر "تذكرني"، اجعله Session Cookie
        // سيتم حذفه بمجرد إغلاق المتصفح تماماً
        req.session.cookie.maxAge = undefined;
      }
      return res.status(200).json({
        message: "تم تسجيل الدخول بنجاح",
        user: user.sendToClientProfile(),
      });
    });
  })(req, res, next);
};

export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  req.logout((err) => {
    if (err) {
      return next(err); // التعامل مع أي خطأ أثناء الخروج
    }

    // 2. تدمير الـ Session في قاعدة البيانات (Store) تماماً
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "فشل في تدمير الجلسة" });
      }

      // 3. مسح الكوكيز من متصفح المستخدم
      res.clearCookie("connect.sid");

      return res.status(200).json({ message: "تم تسجيل الخروج بنجاح" });
    });
  });
};

export const lostPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { username } = req.body;
    if (!username)
      return res.status(401).json({ message: "برجاء إدخل اليوزر" });
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: "هذا اليوزر غير موجود" });
    if (!user.email)
      return res.status(401).json({
        message:
          " \n قم بالتواصل مع مدير الموقع لإرجاعة .لا يمكن إرجاع هذا المستخدم لعدم وجود بريد الكتروني مسجل لديه",
      });
    // توليد كود عشوائي
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const emailTemplate = (resetCode: string) => `
  <div style="font-family: Arial, sans-serif; text-align: right; direction: rtl; border: 1px solid #e0e0e0; padding: 20px; border-radius: 10px;">
    <h2 style="color: #2c3e50;">إعادة تعيين كلمة المرور</h2>
    <p>لقد طلبت إعادة تعيين كلمة المرور لمنصة <strong>Health Education Platform</strong>.</p>
    <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #3498db; border-radius: 5px;">
      ${resetCode}
    </div>
    <p style="margin-top: 20px;">هذا الكود صالح لمدة 10 دقائق فقط. إذا لم تطلب هذا الكود، يرجى تجاهل هذا الإيميل.</p>
    <hr style="border: 0; border-top: 1px solid #eee;" />
    <p style="font-size: 12px; color: #7f8c8d;">جميع الحقوق محفوظة © منصة التثقيف الصحي 2026</p>
  </div>
`;
    const isSent = await sendBrevoEmail(
      user.email,
      "كود التحقق لمنصة التثقيف الصحي",
      emailTemplate(otpCode),
    );

    if (isSent) {
      user.forgetPasswordInfo = {
        otpCode,
        validTime: new Date(Date.now() + 10 * 60 * 1000),
      };
      await user.save();
      res
        .status(200)
        .json({ message: "تم إرسال الكود بنجاح للبريد الإلكتروني" });
    } else {
      res
        .status(500)
        .json({ message: "حدث خطأ في السيرفر أثناء إرسال الإيميل" });
    }
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

export const confirmOtpCode = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { otpCode, username } = req.body;
    if (!otpCode)
      return res.status(400).json({ message: "برجاء إدخل الرمز للتأكيد" });
    if (!username)
      return res.status(400).json({ message: "برجاء إدخل اليوزر" });
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: "هذا اليوزر غير موجود" });

    if (!user.forgetPasswordInfo || !user.forgetPasswordInfo.validTime) {
      return res.status(400).json({ message: "لم يتم طلب تغيير كلمة المرور" });
    }

    if (Date.now() > user.forgetPasswordInfo.validTime.getTime()) {
      return res
        .status(400)
        .json({ message: "انتهت صلاحية الرمز، يرجى طلب كود جديد" });
    }

    // console.log(user.forgetPasswordInfo);
    if (user.forgetPasswordInfo.otpCode !== otpCode) {
      return res.status(400).json({ message: "الرمز غير صحيح" });
    }
    user.forgetPasswordInfo = {
      otpCode: "",
      validTime: null,
    };
    await user.save();

    const token = jwt.sign(
      {
        username,
        verify: true,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: "5m" },
    );

    res
      .cookie("otpToken", token, {
        httpOnly: true, // لا يمكن للـ JavaScript في المتصفح الوصول إليه (أمان عالي)
        secure: process.env.NODE_ENV === "production", // يعمل فقط مع HTTPS في الإنتاج
        sameSite: "strict", // يمنع هجمات CSRF
        maxAge: 5 * 60 * 1000, // ينتهي بعد 5 دقائق (مطابق للتوكن)
      })
      .status(200)
      .json({
        message:
          "الرمز صحيح، يمكنك الآن تغيير كلمة المرور لديك 5 دقائق للتعديل",
      });
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
};

export const changePassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const otpToken = req.cookies.otpToken;
    const { newPassword } = req.body;
    if (!otpToken) {
      return res
        .status(400)
        .json({ message: "انتهت صلاحية الجلسة، اطلب كود جديد" });
    }
    const decoded = jwt.verify(
      otpToken,
      process.env.JWT_SECRET as string,
    ) as any;
    if (!decoded.verify) {
      return res.status(400).json({ message: "غير مصرح لك بتغيير كلمة السر" });
    }

    const user = await User.findOne({ username: decoded.username });
    if (!user)
      return res.status(400).json({ message: "هذا المستخدم غير موجود" });
    user.password = newPassword;
    await user.save();

    res.clearCookie("jwt"); // حذف توكن تسجيل الدخول القديم
    res.clearCookie("otpToken"); // حذف توكن التحقق من الـ OTP
    return res.status(200).json({ message: "تم تغيير كلمة السر بنجاح" });
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
};

export const refreshauth = async (req: Request, res: Response) => {
  // console.log("refresh auth", req.user);
  const { _id } = req.user as IUser;
  try {
    // console.log("refresh auth");
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "يرجى تسجيل الدخول أولاً" });
    }
    const user = await User.findById(_id);
    if (!user) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }
    res.status(200).json(user.sendToClientProfile());
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const profileDisplay = async (req: Request, res: Response) => {
  const { _id } = req.user as IUser;
  try {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "يرجى تسجيل الدخول أولاً" });
    }
    const user = await User.findById(_id);
    if (!user) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }
    res.status(200).json(user.sendToClientProfile());
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateProfile = async (req: Request, res: Response) => {
  const { _id } = req.user as IUser;

  try {
    // 1. استخراج النصوص الأساسية من الـ Body
    const { first_name, last_name, bio, email, oldPassword, newPassword } =
      req.body;
    // console.log("Received update data:", req.body);

    // 5. تحديث قاعدة البيانات
    const user = await User.findById(_id);
    if (!user) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    if (!(await user.comparePassword(oldPassword)))
      return res.status(400).json({ oldPassword: "كلمة السر غير صحيحة" });
    // 2. فك البيانات المعقدة بأمان (استخدام try-catch داخلي لكل JSON.parse)
    const parseJSON = (data: any) => {
      try {
        return data ? JSON.parse(data) : undefined;
      } catch (e) {
        return undefined;
      }
    };

    const location = parseJSON(req.body.location);
    const phoneNumbers = parseJSON(req.body.phone_numbers);
    const socialLinks = parseJSON(req.body.social_links);

    // 3. تجميع البيانات المجهزة للتحديث في كائن واحد
    // ملاحظة: نضع فقط البيانات التي نريد تحديثها فعلياً
    let updateData: any = {
      first_name,
      last_name,
      bio,
      email,
    };

    if (location) updateData.location = location;
    if (phoneNumbers) updateData.phone_numbers = phoneNumbers;
    if (socialLinks) updateData.social_links = socialLinks;

    // 4. معالجة رفع الصورة إلى Cloudinary
    if (req.file) {
      // console.log("جارٍ رفع الصورة: ", req.file.originalname);

      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "health_platform/avatars",
        gravity: "face",
        width: 500,
        height: 500,
        crop: "thumb",
        transformation: [
          { width: 500, height: 500, crop: "fill", gravity: "face" },
          { quality: "auto", fetch_format: "auto" },
        ],
      });

      updateData.avatar_url = result.secure_url;

      // حذف الملف المؤقت من السيرفر فوراً بعد الرفع
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    }

    // دمج البيانات الجديدة مع كائن المستخدم
    Object.assign(user, updateData);

    if (newPassword) user.password = newPassword;

    // حفظ التغييرات (سيقوم بتشغيل الـ Schema Validation)
    await user.save();

    return res.status(200).json({
      success: true,
      user: user.sendToClientProfile(), // تأكد أن هذه الدالة معرفة في الـ Model
    });
  } catch (error: any) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0] as string;
      const value = error.keyValue[field];

      // قاموس لترجمة أسماء الحقول للعربية
      const fieldNames: { [key: string]: string } = {
        username: "اسم المستخدم",
        email: "البريد الإلكتروني",
        phone_numbers: "رقم الهاتف",
      };

      return res.status(400).json({
        [field]: `عذراً، ${fieldNames[field] || field} مسجل لدينا بالفعل.`,
      });
    }
    const errorMsg: string = error.message;
    // console.log(errorMsg.split(","));
    if (
      typeof errorMsg === "string" &&
      errorMsg.startsWith("User validation failed:")
    ) {
      const retMsg: any = {};
      errorMsg
        .slice(errorMsg.indexOf(":") + 1)
        .split(",")
        .forEach((str) => {
          const item = str.split(":") as [string, string];
          retMsg[item[0]?.trim()] = item[1]?.trim();
        });
      return res.status(400).json(retMsg);
    }
    return res.status(500).json({
      message: "خطأ في السيرفر أثناء التحديث",
      error: error.message, // مفيد جداً أثناء التطوير لمعرفة سبب الـ 500
    });
  }
};

// export const searchUsers = async (req: Request, res: Response) => {
//   const UserId = (req.user as IUser)._id;
//   const searchTerm =
//     (typeof req.query.searchTerm === "string"
//       ? req.query.searchTerm
//       : ""
//     ).toLowerCase() || "";
//   const page = parseInt(req.query.page ? String(req.query.page) : "1");
//   const limit = 10; // عدد المستخدمين في كل صفحة
//   const skip = (page - 1) * limit;
//   if (searchTerm.trim().length < 4) {
//     return res
//       .status(400)
//       .json({ message: "يجب ان يكون اسم المستخدم لا يقل عن 4 أحرف" });
//   }
//   try {
//     // const [users, totalUsers] = await Promise.all([
//     //   User.find({
//     //     username: { $regex: searchTerm },
//     //     _id: { $ne: UserId },
//     //   })
//     //     .select("first_name last_name username avatar_url _id")
//     //     .skip(skip)
//     //     .limit(limit)
//     //     .sort({ createdAt: -1 }), // ترتيب من الأحدث للأقدم,
//     //   User.countDocuments({
//     //     username: { $regex: searchTerm },
//     //     _id: { $ne: UserId },
//     //   }),
//     // ]);
//     const searchRegex = new RegExp(searchTerm, "i");
//     const [users, totalUsersResults] = await Promise.all([
//       // الاستعلام عن البيانات
//       User.aggregate([
//         {
//           $addFields: {
//             fullName: { $concat: ["$first_name", " ", "$last_name"] },
//           },
//         },
//         {
//           $match: {
//             _id: { $ne: new mongoose.Types.ObjectId(UserId) }, // تأكد من تحويل UserId لـ ObjectId
//             $or: [
//               { username: searchRegex },
//               { first_name: searchRegex },
//               { last_name: searchRegex },
//               { fullName: searchRegex },
//             ],
//           },
//         },
//         { $sort: { createdAt: -1 } },
//         { $skip: skip },
//         { $limit: limit },
//         {
//           $project: {
//             first_name: 1,
//             last_name: 1,
//             username: 1,
//             avatar_url: 1,
//             _id: 1,
//           },
//         },
//       ]),

//       // حساب العدد الإجمالي
//       User.aggregate([
//         {
//           $addFields: {
//             fullName: { $concat: ["$first_name", " ", "$last_name"] },
//           },
//         },
//         {
//           $match: {
//             _id: { $ne: new mongoose.Types.ObjectId(UserId) },
//             $or: [
//               { username: searchRegex },
//               { first_name: searchRegex },
//               { last_name: searchRegex },
//               { fullName: searchRegex },
//             ],
//           },
//         },
//         { $count: "total" },
//       ]),
//     ]);

//     const totalUsers =
//       totalUsersResults.length > 0 ? totalUsersResults[0].total : 0;
//     res.status(200).json({
//       success: true,
//       data: users,
//       currentPage: page,
//       totalPages: Math.ceil(totalUsers / limit),
//       totalResults: totalUsers,
//     });
//   } catch (err: any) {
//     res.status(400).json({ message: err.message });
//   }
// };

export const searchUsers = async (req: Request, res: Response) => {
  const UserId = (req.user as IUser)._id;

  // 1. استقبال النص سواء جاء باسم query أو searchTerm
  const rawQuery = (req.query.query || req.query.searchTerm || "") as string;
  const searchTerm = rawQuery.trim().toLowerCase();

  const page = parseInt(req.query.page ? String(req.query.page) : "1");
  const limit = parseInt(req.query.limit ? String(req.query.limit) : "10");
  const skip = (page - 1) * limit;

  // تقليل الحد الأدنى لحرفين مثلاً ليعطي مرونة أكبر عند البحث بالبريد أو الاسم
  if (!searchTerm || searchTerm.length < 2) {
    return res
      .status(400)
      .json({ message: "يرجى إدخال حرفين على الأقل للبحث" });
  }

  try {
    const searchRegex = new RegExp(searchTerm, "i");

    const [users, totalUsersResults] = await Promise.all([
      // الاستعلام عن البيانات
      User.aggregate([
        {
          $addFields: {
            fullName: { $concat: ["$first_name", " ", "$last_name"] },
          },
        },
        {
          $match: {
            _id: { $ne: new mongoose.Types.ObjectId(UserId) },
            $or: [
              { email: searchRegex }, // 👈 أضفنا البحث بالبريد الإلكتروني
              { username: searchRegex },
              { first_name: searchRegex },
              { last_name: searchRegex },
              { fullName: searchRegex },
            ],
          },
        },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            first_name: 1,
            last_name: 1,
            username: 1,
            email: 1, // 👈 أضفنا إرجاع البريد
            avatar_url: 1,
            photo_url: "$avatar_url", // لضمان التوافق لو كان الفرونت يستقبل photo_url
            _id: 1,
          },
        },
      ]),

      // حساب العدد الإجمالي
      User.aggregate([
        {
          $addFields: {
            fullName: { $concat: ["$first_name", " ", "$last_name"] },
          },
        },
        {
          $match: {
            _id: { $ne: new mongoose.Types.ObjectId(UserId) },
            $or: [
              { email: searchRegex }, // 👈 البحث بالبريد
              { username: searchRegex },
              { first_name: searchRegex },
              { last_name: searchRegex },
              { fullName: searchRegex },
            ],
          },
        },
        { $count: "total" },
      ]),
    ]);

    const totalUsers =
      totalUsersResults.length > 0 ? totalUsersResults[0].total : 0;

    // 2. إرجاع استجابة مرنة تدعم كلا الواجهتين (القديمة والجديدة)
    return res.status(200).json({
      success: true,
      data: users, // للواجهات السابقة
      users: users, // لـ handleSearchUser (res.data.users)
      user: users[0] || null, // لـ handleSearchUser (res.data.user)
      currentPage: page,
      totalPages: Math.ceil(totalUsers / limit),
      totalResults: totalUsers,
    });
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
};

export const toggleAdmin = async (req: Request, res: Response) => {
  const userId = (req.user as IUser)._id.toString();
  const { id, adminState } = req.body;
  // console.log(id, adminState);
  try {
    const userAdmin = await User.findById(id);
    if (!userAdmin)
      return res.status(404).json({ message: "هذا المستخدم غير موجود" });

    if (id === userId)
      return res
        .status(404)
        .json({ message: "لا يمكنك تعيين هذا المستخدم كمسؤول" });

    if (adminState) {
      userAdmin.role = "admin";
      await userAdmin.save();
      return res.status(200).json({ message: "تم تغيين المستخدم كمشرف بنجاح" });
    }

    userAdmin.role = "user";
    await userAdmin.save();
    return res.status(200).json({ message: "تم إرجاع المشرف كمستخدم بنجاح" });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};
export const findOneUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  const selfId = (req.user as IUser)?._id || "";
  try {
    const user = await User.findById(id);
    if (!user)
      return res.status(404).json({ message: "هذا المستخدم غير موجود" });

    if (!id || typeof id !== "string") {
      return res.status(400).json({ message: "معرف المستخدم غير صالح" });
    }

    const isFollowing = !!(await Follow.exists({
      follower: selfId,
      following: id,
    }));
    res.status(200).json(Object.assign(user.getOneUserInfo(), { isFollowing }));
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

export const followUser = async (req: Request, res: Response) => {
  try {
    const userToFollowId = req.params.id as string;
    const selfId = (req.user as IUser)?._id.toString() || "";

    if (userToFollowId === selfId) {
      return res.status(400).json({ message: "لا يمكنك متابعة نفسك" });
    }

    await Follow.create({
      follower: selfId,
      following: userToFollowId,
    });

    await Promise.all([
      // تحديث عدد الأشخاص الذين أتابعهم
      User.findByIdAndUpdate(selfId, { $inc: { "stats.following": 1 } }),

      // تحديث عدد المتابعين للشخص الآخر
      User.findByIdAndUpdate(userToFollowId, {
        $inc: { "stats.followers": 1 },
      }),
    ]);

    res.status(200).json({ message: "تمت المتابعة بنجاح" });
  } catch (error: any) {
    if (error.code === 11000)
      return res.status(400).json({ message: "أنت تتابعه بالفعل" });
    res.status(500).json({ message: error.message });
  }
};

export const unfollowUser = async (req: Request, res: Response) => {
  const followerId = (req.user as IUser)?._id.toString();
  const followingId = typeof req.params.id === "string" ? req.params.id : "";

  if (!followerId || !followingId) {
    return res.status(400).json({ message: "معرّف المستخدم غير صحيح" });
  }
  try {
    await Follow.findOneAndDelete({
      follower: followerId,
      following: followingId,
    });

    await Promise.all([
      // تحديث عدد الأشخاص الذين أتابعهم
      User.findByIdAndUpdate(followerId, { $inc: { "stats.following": -1 } }),

      // تحديث عدد المتابعين للشخص الآخر
      User.findByIdAndUpdate(followingId, {
        $inc: { "stats.followers": -1 },
      }),
    ]);
    res.status(200).json({ message: "تم إلغاء المتابعة" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getFollowingList = async (req: Request, res: Response) => {
  try {
    // console.log("Getting following list for user:");
    const myId = (req.user as IUser)?._id.toString();
    const searchTerm =
      (typeof req.query.searchTerm === "string"
        ? req.query.searchTerm
        : ""
      ).toLowerCase() || "";
    const page = parseInt(req.query.page ? String(req.query.page) : "1");
    const limit = 10;
    const skip = (page - 1) * limit;

    if (searchTerm.trim().length > 0 && searchTerm.trim().length < 4) {
      return res
        .status(400)
        .json({ message: "يجب ان يكون اسم المستخدم لا يقل عن 4 أحرف" });
    }

    // هنا تضع الكود الأخير (الـ Aggregate)
    const pipeline: any[] = [
      // 1. فلترة سجلات المتابعة الخاصة بي فقط
      { $match: { follower: new mongoose.Types.ObjectId(myId) } },

      // 2. ربط (Join) مع جدول المستخدمين
      {
        $lookup: {
          from: "users", // تأكد أن اسم الكولكشن في قاعدة البيانات هو "users"
          localField: "following",
          foreignField: "_id",
          as: "user_details",
        },
      },

      // 3. تفكيك المصفوفة الناتجة من الربط لتصبح كائناً واحداً
      { $unwind: "$user_details" },
    ];

    if (searchTerm.trim() !== "") {
      pipeline.push({
        $addFields: {
          fullName: {
            $concat: [
              "$user_details.first_name",
              " ",
              "$user_details.last_name",
            ],
          },
        },
      });
      const searchRegex = new RegExp(searchTerm, "i");
      pipeline.push({
        $match: {
          $or: [
            { "user_details.username": searchRegex },
            { "user_details.first_name": searchRegex },
            { "user_details.last_name": searchRegex },
            { fullName: searchRegex }, // الآن fullName متاح للبحث لأنه أضيف في المرحلة السابقة
          ],
        },
      });
    }

    // 3. استخدام $facet للعد والجلب في خطوة واحدة
    pipeline.push({
      $facet: {
        // المسار الأول: حساب العدد الإجمالي للنتائج المفلترة
        totalCount: [{ $count: "count" }],
        // المسار الثاني: جلب البيانات الفعلية مع الترتيب والتقسيم
        data: [
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: "$user_details._id",
              username: "$user_details.username",
              first_name: "$user_details.first_name",
              last_name: "$user_details.last_name",
              avatar_url: "$user_details.avatar_url",
            },
          },
        ],
      },
    });

    // 4. تنفيذ الاستعلام
    const result = await Follow.aggregate(pipeline);

    // 5. استخراج البيانات والعدد الكلي
    const totalResults = result[0].totalCount[0]?.count || 0;
    const following = result[0].data;
    const totalPages = Math.ceil(totalResults / limit);

    // إرسال النتيجة
    res.status(200).json({
      success: true,
      currentPage: page,
      totalPages,
      totalResults,
      data: following,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "حدث خطأ في السيرفر" });
  }
};
