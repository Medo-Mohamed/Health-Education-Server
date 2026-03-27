import type { Request, Response } from "express";
import User, { type IUser } from "../Models/User.ts";
import passport from "passport";
export const createUsers = async (request: Request, response: Response) => {
  try {
    const {
      username,
      password,
      phone_numbers,
      full_name,
      email,
      location,
      avatar_url,
      bio,
      social_links,
    } = request.body;
    const newUser = new User({
      username,
      password,
      phone_numbers,
      full_name,
      email,
      location,
      avatar_url,
      bio,
      social_links,
    });
    await newUser.save();
    // console.log(newUser);
    response.json(newUser);
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
    console.log(errorMsg.split(","));
    if (errorMsg.startsWith("User validation failed:")) {
      const retMsg: any = {};
      errorMsg
        .slice(errorMsg.indexOf(":") + 1)
        .split(",")
        .forEach((str) => {
          const item = str.split(":") as [string, string];
          retMsg[item[0]?.trim()] = item[1]?.trim();
        });
      return response.status(401).json(retMsg);
    }
    response.status(401).json(error.message);
  }
};

export const login = (req: Request, res: Response, next: any) => {
  passport.authenticate("local", (err: any, user: IUser, info: any) => {
    if (err) return next(err);
    if (!user) return res.status(400).json({ message: info.message });

    req.logIn(user, (err) => {
      if (err) return next(err);
      return res.status(200).json({
        message: "تم تسجيل الدخول بنجاح",
        user: { username: user.username, role: user.role },
      });
    });
  })(req, res, next);
};

export const logout = async (req: Request, res: Response, next: any) => {
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
      res.clearCookie("connect.sid"); // تأكد من مطابقة اسم الكوكي في إعدادات الـ session

      return res.status(200).json({ message: "تم تسجيل الخروج بنجاح" });
    });
  });
};
