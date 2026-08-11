// middlewares/validateCreatePlace.ts
import type { Request, Response, NextFunction } from "express";
import { Place } from "../Models/Place.ts";
import { UserPlaceAccess } from "../Models/UserPlaceAccess.ts";
import { PlacePermission, PlaceRole } from "../types/placeAccess.ts";
import mongoose from "mongoose";

export interface AuthenticatedPlaceRequest extends Request {
  user?: any;
  placeAccess?: {
    role: string;
    permissions: PlacePermission[];
    isInherited: boolean;
  };
}

/**
 * @desc    Middleware للتحقق من امتلاك المستخدم لصلاحية محددة على المكان (سواء مباشرة أو بالتوارث)
 * @param   requiredPermission الصلاحية المطلوبة من النوع PlacePermission
 */

// export const authorizePermission = (requiredPermission?: PlacePermission) => {
//   return async (
//     req: AuthenticatedPlaceRequest,
//     res: Response,
//     next: NextFunction,
//   ) => {
//     try {
//       const user = req.user;
//       const userId = user?._id || user?.id;

//       // 1. التحقق من تسجيل الدخول
//       if (!userId) {
//         return res.status(401).json({
//           success: false,
//           message: "غير مصرح. يرجى تسجيل الدخول أولاً.",
//         });
//       }

//       // 👑 2. استثناء المطور (DEV Bypass)
//       if (user.role === "dev") {
//         req.placeAccess = {
//           role: "dev",
//           permissions: Object.values(PlacePermission || {}), // منح كافة الصلاحيات
//           isInherited: false,
//         };
//         return next();
//       }

//       // 3. استخراج معرف المكان
//       const placeId =
//         req.params.placeId ||
//         req.params.id ||
//         req.body.place_id ||
//         req.query.place_id;

//       if (!placeId) {
//         return res.status(400).json({
//           success: false,
//           message: "معرف المكان (placeId) مفقود في الطلب.",
//         });
//       }

//       // 4. جلب المكان
//       const targetPlace = await Place.findById(placeId)
//         .select("ancestors")
//         .lean();

//       if (!targetPlace) {
//         return res.status(404).json({
//           success: false,
//           message: "المكان المطلوب غير موجود.",
//         });
//       }

//       const ancestorsIds = targetPlace.ancestors || [];

//       // 5. الاستعلام عن الصلاحية (مباشرة أو موروثة)
//       const accessRecord = await UserPlaceAccess.findOne({
//         user_id: userId,
//         $or: [
//           { place_id: placeId },
//           { place_id: { $in: ancestorsIds }, inherit_to_children: true },
//         ],
//       });

//       if (!accessRecord) {
//         return res.status(403).json({
//           success: false,
//           message: "ليس لديك أي صلاحية للوصول إلى هذا المكان.",
//         });
//       }

//       // 6. استخراج كافة الصلاحيات
//       const userPermissions = accessRecord.getAllPermissions();

//       // 7. التحقق من وجود الصلاحية المطلوبة (في حال تم التمرير)
//       if (requiredPermission && !userPermissions.includes(requiredPermission)) {
//         return res.status(403).json({
//           success: false,
//           message: `عذراً، لا تمتلك الصلاحية المطلوبة: [${requiredPermission}]`,
//         });
//       }

//       // 8. إرفاق بيانات الوصول
//       const isInherited =
//         accessRecord.place_id.toString() !== placeId.toString();

//       req.placeAccess = {
//         role: accessRecord.role,
//         permissions: userPermissions,
//         isInherited,
//       };

//       return next();
//     } catch (error: any) {
//       console.error("Error in authorizePermission:", error);
//       return res.status(500).json({
//         success: false,
//         message: "حدث خطأ أثناء فحص صلاحيات الوصول.",
//         error: error.message,
//       });
//     }
//   };
// };

export const authorizePermission = (requiredPermission?: PlacePermission) => {
  return async (
    req: AuthenticatedPlaceRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = req.user;
      const userId = user?._id || user?.id;

      // 1. التحقق من تسجيل الدخول
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "غير مصرح. يرجى تسجيل الدخول أولاً.",
        });
      }

      // 👑 2. استثناء المطور (DEV Bypass) - يتجاوز كافة الفحوصات
      if (user.role === "dev") {
        req.placeAccess = {
          role: "dev",
          permissions: Object.values(PlacePermission || {}),
          isInherited: false,
        };
        return next();
      }

      // 3. استخراج معرف المكان (يدعم placeId و parent_id لسيناريو إنشاء الأماكن الفرعية)
      const placeId =
        req.params.placeId ||
        req.params.id ||
        req.body.place_id ||
        req.body.parent_id || // 👈 دعم إضافة مكان فرعي
        req.query.place_id;

      // 🔴 حالة خاصة: إنشاء مكان رئيسي (Root Place) بدون parent_id وبدون placeId
      if (!placeId) {
        // إذا لم يكن هناك مكان أب وكان المستخدم ليس dev (تجاوز أعلاه)، يمنع إنشاء مكان رئيسي
        return res.status(403).json({
          success: false,
          message:
            "غير مسموح بإنشاء مكان رئيسي (بدون أب) إلا بحساب المطور DEV.",
        });
      }

      if (!placeId || !mongoose.Types.ObjectId.isValid(placeId as string)) {
        return res.status(400).json({ message: "معرّف المكان غير صالح." });
      }

      // 4. جلب المكان المراد فحص الصلاحية عليه
      const targetPlace = await Place.findById(placeId)
        .select("ancestors")
        .lean();

      if (!targetPlace) {
        return res.status(404).json({
          success: false,
          message: "المكان المطلوب غير موجود.",
        });
      }

      const ancestorsIds = targetPlace.ancestors || [];

      // 5. الاستعلام عن الصلاحية (مباشرة على المكان أو موروثة من سلاسل الآباء)
      const accessRecord = await UserPlaceAccess.findOne({
        user_id: userId,
        $or: [
          { place_id: placeId },
          { place_id: { $in: ancestorsIds }, inherit_to_children: true },
        ],
      });

      if (!accessRecord) {
        return res.status(403).json({
          success: false,
          message: "ليس لديك أي صلاحية للوصول إلى هذا المكان.",
        });
      }

      // 6. استخراج كافة الصلاحيات الفعلية
      const userPermissions = accessRecord.getAllPermissions();

      // 7. التحقق من وجود الصلاحية المطلوبة
      if (requiredPermission && !userPermissions.includes(requiredPermission)) {
        return res.status(403).json({
          success: false,
          message: `عذراً، لا تمتلك الصلاحية المطلوبة: [${requiredPermission}]`,
        });
      }

      // 8. إرفاق بيانات الوصول لـ req
      const isInherited =
        accessRecord.place_id.toString() !== placeId.toString();

      req.placeAccess = {
        role: accessRecord.role,
        permissions: userPermissions,
        isInherited,
      };

      return next();
    } catch (error: any) {
      console.error("Error in authorizePermission:", error);
      return res.status(500).json({
        success: false,
        message: "حدث خطأ أثناء فحص صلاحيات الوصول.",
        error: error.message,
      });
    }
  };
};
