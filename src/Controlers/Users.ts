import type { Request, Response, NextFunction } from "express";
import User, { type IUser } from "../Models/User.ts";
import passport from "passport";
import { sendBrevoEmail } from "../Config/emailService.ts";
import jwt from "jsonwebtoken";
import cloudinary from "../Config/cloudinary.ts";
import fs from "fs";
export const createUsers = async (request: Request, response: Response) => {
  console.log("Registering user with data:", request.body); // إضافة هذا السطر لتتبع البيانات المستلمة
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

    req.logIn(user, (err) => {
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
        user: user.sendToClient(),
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
    if (!username) res.status(400).json({ message: "برجاء إدخل اليوزر" });
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: "هذا اليوزر غير موجود" });
    if (!user.email)
      return res.status(401).json({
        message: "لا يمكن إرجاع هذا المستخدم لعدم وجود بريد الكتروني مسجل لديه",
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
      res.status(200).json({ message: "تم إرسال الكود بنجاح" });
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
        .json({ message: "انتهت صلاحية الكود، يرجى طلب كود جديد" });
    }

    // console.log(user.forgetPasswordInfo);
    if (user.forgetPasswordInfo.otpCode !== otpCode) {
      return res.status(400).json({ message: "الكود غير صحيح" });
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
          "الكود صحيح، يمكنك الآن تغيير كلمة المرور لديك 5 دقائق للتعديل",
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
    return res.status(400).json({ message: "تم تغيير كلمة السر بنجاح" });
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
    res.status(200).json(user.sendToClient());
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
