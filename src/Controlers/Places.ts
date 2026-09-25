import { type Request, type Response } from "express";
import { Place } from "../Models/Place";
import { UserPlaceAccess } from "../Models/UserPlaceAccess";
import { PlaceRole } from "../types/placeAccess";

// 3. تعديل دور أو صلاحيات موظف في المكان
export const ROLE_WEIGHTS: Record<PlaceRole | "dev", number> = {
  dev: 5,
  [PlaceRole.ADMIN]: 4,
  [PlaceRole.SUPERVISOR]: 3,
  [PlaceRole.OPERATOR]: 2,
  [PlaceRole.VIEWER]: 1,
};

// controllers/placeController.ts
export const getMyPlaces = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { search, scope = "direct", page = 1, limit = 9 } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    // 1. جلب معرفات صلاحيات المستخدم المباشرة
    const userAccesses = await UserPlaceAccess.find({
      user_id: user._id,
    }).select("place_id");
    const directPlaceIds = userAccesses.map((a) => a.place_id);

    let query: any = {};

    // 2. تصفية النطاق (Scope)
    if (user.role === "dev") {
      // الـ DEV يرى كل شيء إذا كان الخيار all، أو الأماكن الجذرية الرئيسية فقط إذا كان direct
      if (scope === "direct") query.parent_id = null;
    } else {
      if (scope === "direct") {
        query._id = { $in: directPlaceIds };
      } else {
        // الخيار ALL: الأماكن المباشرة + الأماكن التي تملك أجدادها (Ancestors) في صلاحيات المستخدم
        query.$or = [
          { _id: { $in: directPlaceIds } },
          { ancestors: { $in: directPlaceIds } },
        ];
      }
    }

    // 3. إضافة شرط البحث بالاسم
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    // 4. تنفيذ الاستعلام مع الباجنيشن
    const total = await Place.countDocuments(query);
    const places = await Place.find(query)
      .skip(skip)
      .limit(limitNum)
      .sort({ createdAt: -1 });

    return res.status(200).json({
      places,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: error.message || "حدث خطأ في جلب الأماكن." });
  }
};
