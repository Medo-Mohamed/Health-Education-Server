import type { Request, Response, NextFunction } from "express";
import { Place } from "../Models/Place.ts";
import {
  UserPlaceAccess,
  type IUserPlaceAccess,
} from "../Models/UserPlaceAccess.ts";
import { PlacePermission } from "../types/placeAccess.ts";
import mongoose, { Types } from "mongoose";

export interface AuthenticatedPlaceRequest extends Request {
  user?: any;
  placeAccess?: {
    role: string;
    permissions: PlacePermission[];
    isInherited: boolean;
    grantedPlaceId: string;
    ancestorsIds: Types.ObjectId[];
    inherit_to_children: boolean;
  };
}

type PermissionInput = PlacePermission | PlacePermission[];
type CheckMode = "AT_LEAST_ONE" | "ALL";

export const authorizePermission = (
  requiredPermissions?: PermissionInput,
  mode: CheckMode = "AT_LEAST_ONE",
) => {
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

      // 👑 2. استثناء المطور (DEV Bypass)
      if (user.role === "dev") {
        req.placeAccess = {
          role: "dev",
          permissions: Object.values(PlacePermission || {}),
          isInherited: false,
          grantedPlaceId: "dev",
          ancestorsIds: [],
          inherit_to_children: true,
        };
        return next();
      }

      // 3. استخراج معرف المكان
      const placeId =
        req.params.placeId ||
        req.params.id ||
        req.params.place_id ||
        req.body.place_id ||
        req.body.parent_id ||
        req.query.place_id;

      if (!placeId) {
        return res.status(403).json({
          success: false,
          message:
            "غير مسموح بإنشاء مكان رئيسي (بدون أب) إلا بحساب المطور DEV.",
        });
      }

      if (!mongoose.Types.ObjectId.isValid(placeId as string)) {
        return res.status(400).json({
          success: false,
          message: "معرّف المكان غير صالح.",
        });
      }

      // 4. جلب المكان وسلسلة الآباء (Ancestors)
      // ملاحظة: افترضنا أن ancestors مرتبة من الأقرب للأبعد [Parent, Grandparent, Great-Grandparent]
      const targetPlace = await Place.findById(placeId)
        .select("ancestors")
        .lean();

      if (!targetPlace) {
        return res.status(404).json({
          success: false,
          message: "المكان المطلوب غير موجود.",
        });
      }

      const ancestorsIds: string[] = (targetPlace.ancestors || []).map(
        (id: any) => id.toString(),
      );

      // 5. جلب **كافة** سجلات صلاحيات المستخدم للمكان وآبائه
      const accessRecords = await UserPlaceAccess.find({
        user_id: userId,
        place_id: { $in: [placeId, ...ancestorsIds] },
      });

      if (!accessRecords || accessRecords.length === 0) {
        return res.status(403).json({
          success: false,
          message: "ليس لديك أي صلاحية للوصول إلى هذا المكان.",
        });
      }

      // 🎯 6. خوارزمية تحديد السجل ذو الأولوية (Priority Resolution Algorithm)
      let activeRecord: IUserPlaceAccess | null = null;

      // أ) البحث عن صلاحية مباشرة على المكان الحالي (لها الأولوية المطلقة)
      const directAccess = accessRecords.find(
        (r) => r.place_id.toString() === placeId.toString(),
      );

      if (directAccess) {
        activeRecord = directAccess;
      } else {
        // ب) إذا لم توجد صلاحية مباشرة، نبحث في الآباء بدءاً من الأب المباشر صعوداً للجد
        for (const ancestorId of ancestorsIds) {
          const inheritedAccess = accessRecords.find(
            (r) =>
              r.place_id.toString() === ancestorId.toString() &&
              r.inherit_to_children === true, // يجب أن تدعم الصلاحية التوارث للأبناء
          );

          if (inheritedAccess) {
            activeRecord = inheritedAccess;
            break; // وُجد السجل الموروث الأقرب للأبن، توقف عن البحث
          }
        }
      }

      // إذا لم ينجح الموظف في الحصول على صلاحية مباشرة أو موروثة تدعم التوارث
      if (!activeRecord) {
        return res.status(403).json({
          success: false,
          message:
            "ليس لديك صلاحية مجهزة لهذا المكان (الصلاحيات العليا لا تتوارث لهذا المكان).",
        });
      }

      // 7. استخراج الصلاحيات الفعالة والغير منتهية من السجل المحدد
      const userPermissions = activeRecord.getAllPermissions();

      // 8. التحقق من الصلاحية المطلوبة
      if (requiredPermissions) {
        const requiredArray = Array.isArray(requiredPermissions)
          ? requiredPermissions
          : [requiredPermissions];

        let hasAccess = false;

        if (mode === "ALL") {
          hasAccess = requiredArray.every((perm) =>
            userPermissions.includes(perm),
          );
        } else {
          hasAccess = requiredArray.some((perm) =>
            userPermissions.includes(perm),
          );
        }

        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            message: `عذراً، لا تمتلك الصلاحيات المطلوبة: [${requiredArray.join(
              ", ",
            )}]`,
          });
        }
      }

      // 9. إرفاق البيانات بـ Request
      const isInherited =
        activeRecord.place_id.toString() !== placeId.toString();

      // console.log(activeRecord);

      req.placeAccess = {
        role: activeRecord.role,
        permissions: userPermissions,
        isInherited,
        grantedPlaceId: activeRecord.place_id.toString(),
        ancestorsIds: targetPlace.ancestors || [],
        inherit_to_children: activeRecord.inherit_to_children,
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
