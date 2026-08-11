import type { Request, Response } from "express";
import type { IUser } from "../Models/User.ts";
import type { IPlace } from "../Models/Place.ts";
declare global {
  namespace Express {
    interface Request {
      user?: IUser; // المستخدم الحالي (أو null إذا لم يكن مسجلاً)
      place?: IPlace; // المكان الحالي (أو null إذا لم يكن محدد)
    }
  }
}
export const isAuthenticated = (req: Request, res: Response, next: any) => {
  if (req.isAuthenticated()) {
    // console.log("🚀 isAuthenticated: User is authenticated:", req.user);
    return next();
  }
  res.status(401).json({ message: "يرجى تسجيل الدخول أولاً" });
};

export const isNotAuthenticated = (req: Request, res: Response, next: any) => {
  if (!req.isAuthenticated()) {
    return next();
  }
  res
    .status(401)
    .json({ message: "لا يمكنك الوصل لهذة الصفحة لأنك مسجل دخول بالفعل" });
};
