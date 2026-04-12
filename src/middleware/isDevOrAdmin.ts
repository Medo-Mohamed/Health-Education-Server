import type { Request, Response } from "express";
import type { IUser } from "../Models/User.ts";
export const isDev = (req: Request, res: Response, next: any) => {
  const user = req.user as IUser;
  if (user.role === "dev") {
    return next();
  }
  res.status(403).json({ message: "ليس لديك صلاحيات مسؤول" });
};

export const isAdmin = (req: Request, res: Response, next: any) => {
  const user = req.user as IUser;
  if (user.role === "admin") {
    return next();
  }
  res.status(403).json({ message: "ليس لديك صلاحيات مشرف" });
};
