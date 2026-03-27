import type { Request, Response } from "express";
export const isAuthenticated = (req: Request, res: Response, next: any) => {
  if (req.isAuthenticated()) {
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
