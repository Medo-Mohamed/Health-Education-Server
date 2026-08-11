import { type Request, type Response } from "express";
import { Place } from "../Models/Place.ts";
import { UserPlaceAccess } from "../Models/UserPlaceAccess.ts";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PlacePermission,
  PlaceRole,
} from "../types/placeAccess.ts";

import cloudinary from "../Config/cloudinary.ts";
import User from "../Models/User.ts";
import type { AuthenticatedPlaceRequest } from "../middleware/validateCreatePlace.ts";
import mongoose from "mongoose";

// 3. تعديل دور أو صلاحيات موظف في المكان
const ROLE_WEIGHTS: Record<PlaceRole, number> = {
  [PlaceRole.ADMIN]: 4,
  [PlaceRole.SUPERVISOR]: 3,
  [PlaceRole.OPERATOR]: 2,
  [PlaceRole.VIEWER]: 1,
};

export const createPlace = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
) => {
  try {
    const { name, type, parent_id, metadata } = req.body;
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "غير مصرح، يرجى تسجيل الدخول أولاً.",
      });
    }

    // 1. جلب المكان الأب وبناء مصفوفة الآباء (Ancestors) إن وجد parent_id
    let ancestors: any[] = [];
    if (parent_id) {
      const parentPlace = await Place.findById(parent_id)
        .select("ancestors")
        .lean();
      if (!parentPlace) {
        return res.status(404).json({
          success: false,
          message: "المكان الأب المحدد غير موجود.",
        });
      }
      ancestors = [...(parentPlace.ancestors || []), parentPlace._id];
    }

    // ☁️ 2. رفع الصورة إلى Cloudinary في حال تم إرفاق ملف
    let photo_url: string | undefined = undefined;
    const file = req.file as { buffer: Buffer } | undefined;

    if (file) {
      photo_url = await new Promise<string>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "places", // اسم المجلد داخل حساب Cloudinary
            resource_type: "image",
            timeout: 120000, // 120 ثانية لتفادي الـ Timeout
            transformation: [
              { quality: "auto:good", fetch_format: "auto" }, // ضغط تلقائي
            ],
          },
          (error, result) => {
            if (error || !result) {
              return reject(
                error || new Error("فشل رفع الصورة إلى Cloudinary"),
              );
            }
            resolve(result.secure_url);
          },
        );

        stream.end(file.buffer);
      });
    }

    // 3. تحليل معالجة الـ Metadata بشكل آمن (سواء كانت Object أو JSON String من FormData)
    let parsedMetadata: Record<string, any> = {};
    if (metadata) {
      if (typeof metadata === "string") {
        try {
          parsedMetadata = JSON.parse(metadata);
        } catch {
          parsedMetadata = {};
        }
      } else if (typeof metadata === "object") {
        parsedMetadata = metadata;
      }
    }

    // 4. إنشاء المكان الجديد
    const newPlace = new Place({
      name,
      type,
      parent_id: parent_id || null,
      ancestors,
      created_by: user._id,
      metadata: {
        ...parsedMetadata,
        photo_url: photo_url || parsedMetadata?.photo_url,
      },
    });

    await newPlace.save();

    // 5. تعيين المنشئ تلقائياً كـ (Place Admin) على هذا المكان الجديد
    await UserPlaceAccess.create({
      user_id: user._id,
      place_id: newPlace._id,
      role: PlaceRole.ADMIN,
      inherit_to_children: true,
      granted_by: user._id,
    });

    return res.status(201).json({
      success: true,
      message: "تم إنشاء المكان وتعيين الصلاحيات بنجاح.",
      place: newPlace,
    });
  } catch (error: any) {
    console.error("خطأ أثناء حفظ المكان:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "حدث خطأ في السيرفر أثناء حفظ المكان.",
    });
  }
};

export const getPlaceDetails = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
) => {
  try {
    // المكان تم تمريره مسبقاً من الـ middleware أو نقوم بجذبه

    const place = req.place || (await Place.findById(req.params.id));

    if (!place) {
      return res.status(404).json({ message: "المكان غير موجود." });
    }

    // 1. جلب بيانات مسار الأجداد (Ancestors Path) مرتبين هرمياً من الأعلى لأسفل
    let ancestorsPath = [];
    if (place.ancestors && place.ancestors.length > 0) {
      ancestorsPath = await Place.find({
        _id: { $in: place.ancestors },
      }).select("name type parent_id");

      // ترتيب الأجداد حسب تسلسل المسار المكتوب في المصفوفة
      ancestorsPath.sort((a, b) => {
        return (
          place.ancestors.indexOf(a._id.toString()) -
          place.ancestors.indexOf(b._id.toString())
        );
      });
    }

    // 2. جلب الأماكن الفرعية المباشرة التي تتبع هذا المكان (Sub-places)
    const subPlaces = await Place.find({ parent_id: place._id }).select(
      "name type metadata",
    );

    // 3. إرجاع النتيجة بالهيكل المتوافق مع الصفحة الأمامية
    return res.status(200).json({
      place,
      ancestorsPath,
      subPlaces,
      permissions: req.placeAccess?.permissions || [],
    });
  } catch (error: any) {
    console.error("خطأ أثناء جلب تفاصيل المكان:", error);
    return res.status(500).json({
      message: "حدث خطأ في السيرفر أثناء جلب تفاصيل المكان.",
      error: error.message,
    });
  }
};

export const validateParentPlace = async (req: Request, res: Response) => {
  try {
    const { parentId } = req.params;
    const user = (req as any).user;

    if (!user) {
      return res
        .status(401)
        .json({ message: "غير مصرح، يرجى تسجيل الدخول أولاً." });
    }

    // 1. البحث عن المكان الأب
    const parentPlace = await Place.findById(parentId);

    if (!parentPlace) {
      return res.status(404).json({
        message: "المكان الأب المحدد غير موجود في النظام.",
      });
    }

    // 2. إذا كان المستخدم DEV يُمكّن مباشرة
    if (user.role === "dev") {
      return res.status(200).json({
        success: true,
        place: parentPlace,
      });
    }

    // 3. التحقق من صلاحية المستخدم على المكان الأب أو أي من الأماكن الأعلى منه (Ancestors)
    const parentChainIds = [parentPlace._id, ...(parentPlace.ancestors || [])];

    const userAccessList = await UserPlaceAccess.find({
      user_id: user._id,
      place_id: { $in: parentChainIds },
    });

    const hasPermission = userAccessList.some((access) => {
      const isDirectParent =
        access.place_id.toString() === parentPlace._id.toString();

      // إذا كانت الصلاحية قادمة من مكان أعلى، نتحقق من وراثة الصلاحية
      if (!isDirectParent && !access.inherit_to_children) {
        return false;
      }

      const allPerms = access.getAllPermissions();
      return (
        access.role === PlaceRole.ADMIN ||
        allPerms.includes(PlacePermission.CREATE_SUB_PLACE)
      );
    });

    if (!hasPermission) {
      return res.status(403).json({
        message: "ليس لديك صلاحية لإضافة مكان فرعي تحت هذا المكان الأب.",
      });
    }

    // 4. إرجاع بيانات المكان الأب بالشكل الذي يتوقعه الـ Frontend
    return res.status(200).json({
      success: true,
      place: parentPlace,
    });
  } catch (error: any) {
    console.error("خطأ أثناء التحقق من المكان الأب:", error);
    return res.status(500).json({
      message: "حدث خطأ في السيرفر أثناء التحقق من المكان الأب.",
      error: error.message,
    });
  }
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

// 1. جلب طاقم العمل التابع للمكان (مباشر + موروث)
export const getPlaceStaff = async (req: Request, res: Response) => {
  try {
    const { placeId } = req.params;

    // التأكد من وجود المكان
    const place = await Place.findById(placeId);
    if (!place) {
      return res.status(404).json({ message: "المكان غير موجود." });
    }

    // المعرفات التي تؤثر على هذا المكان (المكان نفسه + الأجداد)
    // const parentChainIds = [place._id, ...(place.ancestors || [])]; // للحصول على جميع الصلاحيات الموروثة من الأعلى

    const currentPlaceIds = [place._id]; // للحصول على جميع الصلاحيات الموروثة من الأعلى

    // جلب جميع الصلاحيات المسجلة على هذه المعرفات مع تفاصيل بيانات المستخدم والمنشئ
    const accesses = await UserPlaceAccess.find({
      place_id: { $in: currentPlaceIds },
    })
      .populate("user_id", "first_name last_name email phone avatar_url role")
      .populate("granted_by", "first_name last_name");

    // فلترة وتنظيم النتائج لتمييز الموظف المباشر من الموظف الموروث من أعلى
    const staffList = accesses
      .filter((access) => {
        const isDirect = access.place_id.toString() === place._id.toString();
        // إذا لم يكن مباشراً، نتحقق من تفعيل الوراثة
        return isDirect || access.inherit_to_children;
      })
      .map((access) => {
        const isDirect = access.place_id.toString() === place._id.toString();
        return {
          _id: access._id,
          user: access.user_id,
          place_id: access.place_id,
          role: access.role,
          custom_permissions: access.custom_permissions,
          effective_permissions: access.getAllPermissions(),
          inherit_to_children: access.inherit_to_children,
          is_direct: isDirect, // true = تعيين مباشر في هذا المكان، false = موروث من مكان أعلى
          granted_by: access.granted_by,
          created_at: access.created_at,
        };
      });

    return res.status(200).json({
      success: true,
      count: staffList.length,
      staff: staffList,
    });
  } catch (error: any) {
    console.error("خطأ في جلب موظفي المكان:", error);
    return res
      .status(500)
      .json({ message: "حدث خطأ في السيرفر أثناء جلب الموظفين." });
  }
};

// 2. تعيين / إضافة موظف جديد للمكان
export const addStaffToPlace = async (req: Request, res: Response) => {
  try {
    const { placeId } = req.params;

    const { user_id, role, custom_permissions, inherit_to_children } = req.body;
    // console.log(role);
    const currentUser = (req as any).user;
    const placeAccess = (req as any).placeAccess; // البيانات الممررة من الـ Middleware

    if (!user_id || !role) {
      return res
        .status(400)
        .json({ message: "يرجى تحديد المستخدم والدور المطلوب." });
    }

    const formattedRole = role as PlaceRole;
    const targetRoleWeight = ROLE_WEIGHTS[formattedRole];

    if (targetRoleWeight === undefined) {
      return res
        .status(400)
        .json({ message: "الدور الوظيفي المحدد غير صالح." });
    }

    // 1. التحقق من هرمية الأدوار واستثناء الحسابات البرمجية وإدارة النظام (DEV & SUPER_ADMIN)
    const isBypassUser = currentUser?.role === "dev";

    if (!isBypassUser) {
      // التأكد من وصول بيانات PlaceAccess من الـ Middleware
      if (!placeAccess || !placeAccess.role) {
        return res.status(403).json({
          message: "ليس لديك صلاحية لإضافة موظفين في هذا المكان.",
        });
      }

      const currentUserRole = placeAccess.role as PlaceRole;
      const currentUserWeight = ROLE_WEIGHTS[currentUserRole] || 0;

      // منع منح دور مساوٍ أو أعلى من دور المستخدم الحالي
      if (targetRoleWeight >= currentUserWeight) {
        return res.status(403).json({
          message:
            "لا يمكنك منح صلاحية تسلّم دور مساوٍ لدورك أو أعلى منه. يمكنك منح أدوار أقل فقط.",
        });
      }
    }

    // 2. فلترة وتحقق أمن الصلاحيات المخصصة (Custom Permissions)
    const validPermissionsList = Object.values(PlacePermission) as string[];
    // console.log(custom_permissions);

    // فلترة القيم المدخلة لضمان صلاحيات نظام معرفة فقط
    let sanitizedCustomPermissions = Array.isArray(custom_permissions)
      ? custom_permissions.filter((perm) => validPermissionsList.includes(perm))
      : [];

    // إذا لم يكن DEV/SUPER_ADMIN، يجب ألا يُعطى الموظف الجديد إلا الصلاحيات التي يملكها المنشئ بالفعل
    if (!isBypassUser) {
      const currentUserPermissions: string[] = placeAccess?.permissions || [];
      const newsanitizedCustomPermissions = sanitizedCustomPermissions.filter(
        (perm) => currentUserPermissions.includes(perm),
      );
      if (
        newsanitizedCustomPermissions.length !==
        sanitizedCustomPermissions.length
      ) {
        return res.status(403).json({
          message: "لا يمكنك منح صلاحيات غير متوفرة لديك.",
        });
      }
    }

    // 3. التحقق من وجود المستخدم المراد إضافته
    const targetUser = await User.findById(user_id);
    if (!targetUser) {
      return res
        .status(404)
        .json({ message: "المستخدم المراد إضافته غير موجود." });
    }

    // 4. التأكد من عدم وجود تعيين مسبق للمستخدم في هذا المكان
    const existingAccess = await UserPlaceAccess.findOne({
      user_id,
      place_id: placeId,
    });

    if (existingAccess) {
      return res.status(400).json({
        message:
          "هذا المستخدم مضاف بالفعل في هذا المكان. يمكنك تعديل صلاحياته بدلاً من إضافته.",
      });
    }

    // console.log(sanitizedCustomPermissions);
    // 5. إنشاء سجل الوصول الجديد
    const newAccess = new UserPlaceAccess({
      user_id,
      place_id: placeId,
      role: formattedRole,
      custom_permissions: sanitizedCustomPermissions,
      inherit_to_children: inherit_to_children ?? true,
      granted_by: currentUser._id,
    });

    await newAccess.save();
    await newAccess.populate(
      "user_id",
      "first_name last_name email avatar_url role",
    );

    return res.status(201).json({
      success: true,
      message: "تمت إضافة الموظف للمكان بنجاح.",
      staff: {
        id: newAccess._id,
        user_id: newAccess.user_id,
        role: newAccess.role,
        custom_permissions: newAccess.custom_permissions,
        inherit_to_children: newAccess.inherit_to_children,
        created_at: (newAccess as any).createdAt,
      },
    });
  } catch (error: any) {
    console.error("خطأ في إضافة الموظف:", error);
    return res
      .status(500)
      .json({ message: "حدث خطأ في الخادم أثناء إضافة الموظف." });
  }
};

export const updateStaffAccess = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
) => {
  try {
    const { placeId, userId } = req.params; // معرف المكان والموظف المستهدف
    const {
      role,
      custom_permissions,
      inherit_to_children,
      transfer_granted_by,
    } = req.body;

    const currentUserId = req.user?._id?.toString();

    // 1. البحث عن سجل صلاحية الموظف المستهدف
    const targetAccess = await UserPlaceAccess.findOne({
      place_id: placeId,
      user_id: userId,
    });

    if (!targetAccess) {
      return res.status(404).json({
        success: false,
        message: "سجل صلاحية الموظف غير موجود في هذا المكان.",
      });
    }

    // console.log(targetAccess.granted_by.toString(), currentUserId);

    // المستخدم المنزه عن القيود (Dev أو المنشئ الاصلي للسجل)
    const isDev = req.user?.role === "dev";

    // console.log(currentUserId);
    // console.log(isDev);

    // 4. القيود الصارمة للمستخدمين العاديين (غير Dev/Grantor)
    if (!isDev) {
      // 🔒 منع التعديل على الذات
      if (currentUserId === userId) {
        return res.status(403).json({
          success: false,
          message: "لا يمكنك التعديل على صلاحياتك الشخصية.",
        });
      }

      const modifierRole = req.placeAccess?.role as PlaceRole;
      if (!modifierRole) {
        return res.status(403).json({
          success: false,
          message: "تعذر التحقق من دورك وسلطتك في هذا المكان.",
        });
      }

      const modifierWeight = ROLE_WEIGHTS[modifierRole] || 0;
      const targetCurrentWeight =
        ROLE_WEIGHTS[targetAccess.role as PlaceRole] || 0;

      // 🔒 منع التعديل من الأساس على شخص له نفس الرتبة أو أعلى
      if (targetCurrentWeight >= modifierWeight) {
        return res.status(403).json({
          success: false,
          message:
            "لا يمكنك تعديل صلاحيات موظف يملك دوراً مساوياً لدورك أو أعلى منك.",
        });
      }

      // 🔒 منع إعطاء/ترقية لمُنصِب أعلى أو مساوٍ لرتبة المُعدِّل
      if (role) {
        const newRoleWeight = ROLE_WEIGHTS[role as PlaceRole] || 0;
        if (newRoleWeight >= modifierWeight) {
          return res.status(403).json({
            success: false,
            message: "لا يمكنك منح الموظف دوراً مساوياً لدورك أو أعلى منك.",
          });
        }
      }
    }

    // 5. تحديث الدور إذا تم إرساله (ولم تكن هناك عملية نقل منصب مسيطرة)
    if (role && !transfer_granted_by) {
      const validRoles = Object.values(PlaceRole);
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: "الدور الوظيفي الممرر غير صالح.",
        });
      }
      targetAccess.role = role;
    }

    // 6. التحقق من الصلاحيات المخصصة (custom_permissions)
    if (custom_permissions !== undefined && Array.isArray(custom_permissions)) {
      const validPermissions = Object.values(PlacePermission) as string[];
      const isValid = custom_permissions.every((perm: any) =>
        validPermissions.includes(perm),
      );

      if (!isValid) {
        return res.status(400).json({
          success: false,
          message: "تحتوي القائمة على صلاحيات غير معرفة في النظام.",
        });
      }

      // 🔒 السماح فقط بإعطاء الصلاحيات المتاحة لدى المُعدِّل (من req.placeAccess.permissions)
      if (!isDev) {
        const modifierPermissions: string[] =
          req.placeAccess?.permissions || [];

        const hasUnauthorizedPerms = custom_permissions.some(
          (perm: string) => !modifierPermissions.includes(perm),
        );

        if (hasUnauthorizedPerms) {
          return res.status(403).json({
            success: false,
            message: "لا يمكنك منح الموظف صلاحيات مخصصة لا تمتلكها أنت شخصياً.",
          });
        }
      }

      // تصفية الصلاحيات المخصصة الزائدة عن الصلاحيات التلقائية للدور الجديد/الحالي
      const activeRole = targetAccess.role as PlaceRole;
      const defaultPerms = DEFAULT_ROLE_PERMISSIONS[activeRole] || [];

      targetAccess.custom_permissions = custom_permissions.filter(
        (perm: PlacePermission) => !defaultPerms.includes(perm),
      );
    }

    // 7. تحديث التوارث للأبناء
    if (typeof inherit_to_children === "boolean") {
      targetAccess.inherit_to_children = inherit_to_children;
    }

    // 8. الحفظ والتنسيق
    await targetAccess.save();
    await targetAccess.populate(
      "user_id",
      "first_name last_name email photo_url role",
    );

    return res.status(200).json({
      success: true,
      message: transfer_granted_by
        ? "تم نقل المنصب وتحديث صلاحيات الموظف بنجاح."
        : "تم تحديث صلاحيات الموظف بنجاح.",
      staff: targetAccess,
    });
  } catch (error: any) {
    console.error("خطأ في تحديث صلاحيات الموظف:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تعديل صلاحيات الموظف.",
      error: error.message,
    });
  }
};
// 4. إزالة موظف من المكان
export const removeStaffFromPlace = async (req: Request, res: Response) => {
  try {
    const { accessId } = req.params; // معرّف سجل التعيين (UserPlaceAccess ID)
    const currentUser = req.user; // المستخدم الحالي الحاصل على الـ Authentication

    if (!currentUser) {
      return res
        .status(401)
        .json({ message: "غير مصرح لك، يرجى تسجيل الدخول." });
    }

    // 1. جلب سجل التعيين المراد حذفه
    const targetAccess = await UserPlaceAccess.findById(accessId);

    if (!targetAccess) {
      return res.status(404).json({ message: "سجل الوصول/التعيين غير موجود." });
    }

    const targetUserId = targetAccess.user_id.toString();
    const currentUserId = currentUser._id.toString();

    // 🔴 الشرط 2: لا يمكن للشخص حذف نفسه
    if (targetUserId === currentUserId) {
      return res.status(400).json({
        message: "لا يمكنك إزالة صلاحيتك الخاصة بنفسك من هذا المكان.",
      });
    }

    // 🟢 الشرط 1 (أ): إذا كان المستخدم Dev أو Super Admin -> حذف فوراً
    const isDevOrSuperAdmin = currentUser.role === "dev";

    if (isDevOrSuperAdmin) {
      await UserPlaceAccess.findByIdAndDelete(accessId);
      return res
        .status(200)
        .json({ message: "تمت إزالة الموظف بنجاح بواسطة مسؤول النظام." });
    }

    // 🟢 الشرط 1 (ب): إذا كان المستخدم الحالي هو من منح هذه الصلاحية (granted_by) -> حذف فوراً
    const isGrantedBy =
      targetAccess.granted_by &&
      targetAccess.granted_by.toString() === currentUserId;

    if (isGrantedBy) {
      await UserPlaceAccess.findByIdAndDelete(accessId);
      return res.status(200).json({
        message: "تمت إزالة الموظف بنجاح (بصفتك من قام بمنحه الصلاحية).",
      });
    }

    // -------------------------------------------------------------------------
    // إذا لم يكن Dev أو GrantedBy، يتم التحقق من الصلاحيات ووزن الرتبة
    // -------------------------------------------------------------------------

    // أ) جلب سجل التعيين الخاص بالمستخدم الحالي في نفس المكان (place_id)
    const currentUserAccess = await UserPlaceAccess.findOne({
      place_id: targetAccess.place_id,
      user_id: currentUserId,
    });

    if (!currentUserAccess) {
      return res.status(403).json({
        message: "ليس لديك أي صلاحية في هذا المكان لإجراء عمليات الحذف.",
      });
    }

    // ب) استخدام Instance Method (getAllPermissions) للتحقق من امتلاك صلاحية إدارة الأعضاء
    const currentUserPermissions = currentUserAccess.getAllPermissions();
    const hasManagePermission = currentUserPermissions.includes(
      PlacePermission.MANAGE_MEMBERS,
    );

    if (!hasManagePermission && currentUserAccess.role !== PlaceRole.ADMIN) {
      return res.status(403).json({
        message:
          "ليس لديك صلاحية إدارة الموظفين (MANAGE_MEMBERS) في هذا المكان.",
      });
    }

    // 🟢 الشرط 3: المقارنة باستخدام ROLE_WEIGHTS (حذف الرتب الأدنى فقط)
    const currentUserWeight = ROLE_WEIGHTS[currentUserAccess.role] || 0;
    const targetUserWeight = ROLE_WEIGHTS[targetAccess.role] || 0;

    if (currentUserWeight <= targetUserWeight) {
      return res.status(403).json({
        message: "عفواً، لا يمكنك حذف موظف يملك رتبة مساوية لك أو أعلى منك.",
      });
    }

    // التنفيذ النهائي للحذف
    await UserPlaceAccess.findByIdAndDelete(accessId);

    return res.status(200).json({
      message: "تمت إزالة الموظف من المكان بنجاح.",
    });
  } catch (error: any) {
    console.error("Error in removeStaffFromPlace:", error);
    return res.status(500).json({
      message: "حدث خطأ في السيرفر أثناء محاولة إزالة الموظف.",
      error: error.message,
    });
  }
};

/**
 * @desc    جلب الدور والصلاحيات الخاصة بموظف معين داخل مكان
 * @route   GET /api/places/:placeId/staff/:userId/permissions
 * @access  Private (Admin / Manage Members)
 */
export const getStaffPermissions = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
) => {
  try {
    const { placeId, userId } = req.params;

    // البحث عن سجل الصلاحية وجلب بيانات المستخدم المرتبطة
    const access = await UserPlaceAccess.findOne({
      place_id: placeId,
      user_id: userId,
    }).populate("user_id", "first_name last_name email avatar_url role");

    if (!access) {
      return res.status(404).json({
        success: false,
        message: "سجل صلاحيات الموظف غير موجود في هذا المكان.",
      });
    }

    // console.log("🚀 Retrieved staff access:", access);

    const role = access.role as PlaceRole;

    return res.status(200).json({
      success: true,
      data: {
        staff_info: access.user_id, // البيانات الشخصية للموظف
        role: access.role,
        custom_permissions: access.custom_permissions || [],
        inherit_to_children: access.inherit_to_children,
        default_permissions: DEFAULT_ROLE_PERMISSIONS[role] || [],
        all_permissions: access.getAllPermissions(), // الصلاحيات الشاملة باستخدام دالة الموديل
      },
    });
  } catch (error: any) {
    console.error("خطأ في جلب بيانات صلاحيات الموظف:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب بيانات الصلاحيات.",
      error: error.message,
    });
  }
};

export const updateStaffPermissions = async (req: Request, res: Response) => {
  try {
    const { placeId, userId } = req.params;
    const { role, custom_permissions, inherit_to_children } = req.body;

    // 1. البحث عن سجل الموظف
    const accessRecord = await UserPlaceAccess.findOne({
      place_id: placeId,
      user_id: userId,
    });

    if (!accessRecord) {
      return res.status(404).json({
        success: false,
        message: "سجل صلاحيات الموظف غير موجود في هذا المكان",
      });
    }

    // 2. التحقق من صحة الدور الوظيفي (Role Validation)
    if (role) {
      const validRoles = Object.values(PlaceRole);
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: "الدور الوظيفي الممرر غير صالح",
        });
      }
      accessRecord.role = role;
    }

    // 3. التحقق من صحة وتصفية الصلاحيات المخصصة (Custom Permissions)
    if (custom_permissions !== undefined && Array.isArray(custom_permissions)) {
      const validPermissions = Object.values(PlacePermission);
      const isValid = custom_permissions.every((perm: any) =>
        validPermissions.includes(perm),
      );

      if (!isValid) {
        return res.status(400).json({
          success: false,
          message: "تحتوي القائمة على صلاحيات غير معرفة في النظام",
        });
      }

      // إستبعاد الصلاحيات الموجودة بالفعل ضمن الدور الافتراضي لتجنب التكرار في قاعدة البيانات
      const targetRole = accessRecord.role;
      const defaultPerms = DEFAULT_ROLE_PERMISSIONS[targetRole] || [];

      const cleanedCustomPermissions = custom_permissions.filter(
        (perm: PlacePermission) => !defaultPerms.includes(perm),
      );

      accessRecord.custom_permissions = cleanedCustomPermissions;
    }

    // 4. تحديث خاصية توارث الصلاحية للأماكن الأبناء (inherit_to_children)
    if (typeof inherit_to_children === "boolean") {
      accessRecord.inherit_to_children = inherit_to_children;
    }

    // حفظ التعديلات
    await accessRecord.save();

    return res.status(200).json({
      success: true,
      message: "تم تحديث دور وصلاحيات الموظف بنجاح",
      data: {
        role: accessRecord.role,
        custom_permissions: accessRecord.custom_permissions,
        inherit_to_children: accessRecord.inherit_to_children,
        all_permissions: accessRecord.getAllPermissions(),
      },
    });
  } catch (error: any) {
    console.error("Error in updateStaffPermissions:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث الصلاحيات",
      error: error.message,
    });
  }
};

export const getEligibleUsersForPlace = async (req: Request, res: Response) => {
  try {
    const { placeId } = req.params;
    const { q, page = 1, limit = 10 } = req.query;

    // 1. العثور على المكان وجلب سلسلة الأماكن الاباء (Ancestors / Parent Chain)
    // إذا كان المكان يحتوي على حقل parent_id أو مصفوفة ancestors/path
    const place = await Place.findById(placeId).select(
      "parent_id ancestors path",
    );

    if (!place) {
      return res.status(404).json({ message: "المكان غير موجود." });
    }

    // تجميع كافة الأماكن العليا (الآباء والأجداد)
    // نفترض هنا استخدام parent_id أو مصفوفة ancestors، يمكنك تعديلها حسب بنية جدول Tempat/Place لديك
    let ancestorPlaceIds: mongoose.Types.ObjectId[] = [];

    if (place.ancestors && Array.isArray(place.ancestors)) {
      ancestorPlaceIds = place.ancestors;
    } else if (place.parent_id) {
      // في حال وجود أب مباشر فقط، يمكن جلب شجرة الآباء بحلقة تكرارية أو استعلام إضافي
      ancestorPlaceIds = await getParentChainIds(place.parent_id);
    }

    // 2. جلب ID المستخدمين المضافين مباشرة إلى المكان الحالي
    const directAccesses = await UserPlaceAccess.find({
      place_id: placeId,
    }).select("user_id");

    const directUserIds = directAccesses.map((acc) => acc.user_id);

    // 3. جلب ID المستخدمين الذين لديهم صلاحيات مورّثة من الأماكن العليا
    let inheritedUserIds: mongoose.Types.ObjectId[] = [];
    if (ancestorPlaceIds.length > 0) {
      const inheritedAccesses = await UserPlaceAccess.find({
        place_id: { $in: ancestorPlaceIds },
        inherit_to_children: true, // فقط من لديهم خيار التوريث مفعّل
      }).select("user_id");

      inheritedUserIds = inheritedAccesses.map((acc) => acc.user_id);
    }

    // 4. دمج جميع IDs المستخدمين المستبعدين ومنع التكرار
    const excludedUserIds = [
      ...new Set([
        ...directUserIds.map((id) => id.toString()),
        ...inheritedUserIds.map((id) => id.toString()),
      ]),
    ].map((id) => new mongoose.Types.ObjectId(id));

    // 5. بناء استعلام البحث عن المستخدمين المؤهلين
    const userSearchQuery: any = {
      _id: { $nin: excludedUserIds }, // استبعاد غير المؤهلين
    };

    // إضافة نص البحث إذا توفر في الطلب (Search Filter)
    if (q && typeof q === "string" && q.trim() !== "") {
      const searchRegex = new RegExp(q.trim(), "i");
      userSearchQuery.$or = [
        { username: searchRegex },
        { first_name: searchRegex },
        { last_name: searchRegex },
        { email: searchRegex },
      ];
    }

    // 6. التنفيذ مع الترقيم (Pagination)
    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.max(1, parseInt(limit as string, 10));
    const skip = (pageNum - 1) * limitNum;

    const [users, totalUsers] = await Promise.all([
      User.find(userSearchQuery)
        .select("first_name last_name username email avatar_url role")
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(userSearchQuery),
    ]);

    // 7. تحضير الاستجابة
    const formattedUsers = users.map((u) => ({
      id: u._id,
      name: `${u.first_name} ${u.last_name}`,
      username: u.username,
      email: u.email || "",
      avatar: u.avatar_url,
    }));

    return res.status(200).json({
      success: true,
      data: formattedUsers,
      pagination: {
        total: totalUsers,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalUsers / limitNum),
      },
    });
  } catch (error: any) {
    console.error("خطأ أثناء جلب المستخدمين المؤهلين:", error);
    return res.status(500).json({
      message: "حدث خطأ في الخادم أثناء معالجة الطلب.",
      error: error.message,
    });
  }
};

/**
 * دالة مساعدة لجلب كافة معرفات الآباء متسلسلة للأعلى
 * (تستخدم فقط إذا كانت بنية جدول المكان تعتمد على parent_id فقط)
 */
async function getParentChainIds(
  startParentId: mongoose.Types.ObjectId,
): Promise<mongoose.Types.ObjectId[]> {
  const parentIds: mongoose.Types.ObjectId[] = [];
  let currentId: mongoose.Types.ObjectId | null = startParentId;

  while (currentId) {
    parentIds.push(currentId);
    const parentPlace: any = await Place.findById(currentId)
      .select("parent_id")
      .lean();
    currentId = parentPlace?.parent_id
      ? (parentPlace.parent_id as mongoose.Types.ObjectId)
      : null;
  }

  return parentIds;
}
