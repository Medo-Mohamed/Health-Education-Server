import { type Request, type Response } from "express";
import { Place, type IPlace } from "../Models/Place.ts";
import {
  UserPlaceAccess,
  type ICustomPermission,
} from "../Models/UserPlaceAccess.ts";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PlacePermission,
  PlaceRole,
} from "../types/placeAccess.ts";

import cloudinary from "../Config/cloudinary.ts";
import User, { type IUser } from "../Models/User.ts";
import type { AuthenticatedPlaceRequest } from "../middleware/validateCreatePlace.ts";
import mongoose, { Types } from "mongoose";
import TopicsTables from "../Models/TopicsTables.ts";
import {
  EventLocationType,
  PlaceEvent,
  type IPlaceEvent,
} from "../Models/PlaceEvent.ts";
import { PlacePlan, PlanStatus, type IPlacePlan } from "../Models/PlacePlan.ts";

// 3. تعديل دور أو صلاحيات موظف في المكان
const ROLE_WEIGHTS: Record<PlaceRole | "dev", number> = {
  dev: 5,
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
      userRole: req.placeAccess?.role || "",
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

    // 1. التحقق من وجود المستخدم
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "غير مصرح، يرجى تسجيل الدخول أولاً.",
      });
    }

    // 2. التحقق من صحة معرف المكان
    if (!Types.ObjectId.isValid(parentId as string)) {
      return res.status(400).json({
        success: false,
        message: "معرف المكان الأب غير صالح.",
      });
    }

    // 3. البحث عن المكان الأب
    const parentPlace = await Place.findById(parentId);

    if (!parentPlace) {
      return res.status(404).json({
        success: false,
        message: "المكان الأب المحدد غير موجود في النظام.",
      });
    }

    // 4. استثناء مطوري النظام (DEV Role)
    if (user.role === "dev") {
      return res.status(200).json({
        success: true,
        place: parentPlace,
      });
    }

    // 5. تجميع سلسلة الأماكن للتحقق من الصلاحيات والتوارث (المكان الحالي + الأجداد)
    const parentChainIds = [parentPlace._id, ...(parentPlace.ancestors || [])];

    // جلب جميع وثائق الوصول المرتبطة بالمستخدم ضمن الهيكل الهرمي
    const userAccessList = await UserPlaceAccess.find({
      user_id: user._id,
      place_id: { $in: parentChainIds },
    });

    // 6. فحص الصلاحيات الفعالة (Active Permissions)
    const hasPermission = userAccessList.some((access) => {
      // استخراج كافة الصلاحيات السارية (تستثني تلقائياً الأدوار الصلاحيات المنتهية)
      const activePermissions = access.getAllPermissions();

      // إذا لم يمتلك صلاحية إنشاء مكان فرعي بناءً على الصلاحيات النشطة، يتخطى
      if (!activePermissions.includes(PlacePermission.CREATE_SUB_PLACE)) {
        return false;
      }

      const isDirectParent =
        access.place_id.toString() === parentPlace._id.toString();

      // إذا كانت الصلاحية قادمة من مكان أعلى في الشجرة (Ancestor)، يشترط تفعيل التوارث
      if (!isDirectParent && !access.inherit_to_children) {
        return false;
      }

      return true;
    });

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: "ليس لديك صلاحية لإضافة مكان فرعي تحت هذا المكان الأب.",
      });
    }

    // 7. نجاح التحقق وإرجاع البيانات
    return res.status(200).json({
      success: true,
      place: parentPlace,
    });
  } catch (error: any) {
    console.error("خطأ أثناء التحقق من المكان الأب:", error);
    return res.status(500).json({
      success: false,
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

    const now = new Date();

    // فلترة وتنظيم النتائج لتمييز الموظف المباشر من الموظف الموروث من أعلى
    const staffList = accesses
      .filter((access) => {
        const isDirect = access.place_id.toString() === place._id.toString();
        // إذا لم يكن مباشراً، نتحقق من تفعيل الوراثة
        return isDirect || access.inherit_to_children;
      })
      .map((access) => {
        const isDirect = access.place_id.toString() === place._id.toString();

        // 1. التحقق مما إذا كان الدور كاملاً منتهي الصلاحية
        const isRoleExpired =
          access.role_expires_at && new Date(access.role_expires_at) < now;

        // 2. فلترة الصلاحيات الاستثنائية السارية فقط (الغير منتهية الصلاحية)
        const validCustomPermissions = isRoleExpired
          ? []
          : (access.custom_permissions || []).filter(
              (cp: ICustomPermission) => {
                if (!cp.expires_at) return true; // صلاحية دائمة
                return new Date(cp.expires_at) > now; // صالحة إذا كان تاريخ الانتهاء في المستقبل
              },
            );

        return {
          _id: access._id,
          user: access.user_id,
          place_id: access.place_id,
          role: access.role,
          role_expires_at: access.role_expires_at,
          custom_permissions: validCustomPermissions, // الصلاحيات الاستثنائية النشطة والسارية فقط
          effective_permissions: access.getAllPermissions(), // كافّة الصلاحيات المدمجة والفعالة
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
export const addStaffToPlace = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
) => {
  try {
    const { placeId } = req.params;
    const {
      user_id,
      role,
      role_expires_at,
      custom_permissions,
      inherit_to_children,
    } = req.body;

    const currentUser = req.user;
    const placeAccess = req.placeAccess; // البيانات الممررة من ה-Middleware

    if (!user_id || !role) {
      return res.status(400).json({
        success: false,
        message: "يرجى تحديد المستخدم والدور المطلوب.",
      });
    }

    const formattedRole = role as PlaceRole;
    const targetRoleWeight = ROLE_WEIGHTS[formattedRole];

    if (targetRoleWeight === undefined) {
      return res.status(400).json({
        success: false,
        message: "الدور الوظيفي المحدد غير صالح.",
      });
    }

    // 1. التحقق من هرمية الأدوار واستثناء الحسابات البرمجية (Dev)
    const isBypassUser = currentUser?.role === "dev";

    if (!isBypassUser) {
      if (!placeAccess || !placeAccess.role) {
        return res.status(403).json({
          success: false,
          message: "ليس لديك صلاحية لإضافة موظفين في هذا المكان.",
        });
      }

      const currentUserRole = placeAccess.role as PlaceRole;
      const currentUserWeight = ROLE_WEIGHTS[currentUserRole] || 0;

      // منع منح دور مساوٍ أو أعلى من دور المستخدم الحالي
      if (targetRoleWeight >= currentUserWeight) {
        return res.status(403).json({
          success: false,
          message:
            "لا يمكنك منح صلاحية تسلّم دور مساوٍ لدورك أو أعلى منه. يمكنك منح أدوار أقل فقط.",
        });
      }
    }

    // 2. معالجة وفحص الصلاحيات المخصصة (Custom Permissions) وفق السكيمة الجديدة
    const validPermissionsList = Object.values(PlacePermission) as string[];
    const formattedCustomPermissions: ICustomPermission[] = [];

    if (Array.isArray(custom_permissions)) {
      for (const item of custom_permissions) {
        const permName = typeof item === "string" ? item : item?.permission;
        const expiresAt =
          typeof item === "object" && item?.expires_at
            ? new Date(item.expires_at)
            : null;

        if (!validPermissionsList.includes(permName)) {
          return res.status(400).json({
            success: false,
            message: `الصلاحية المخصصة [${permName}] غير معرفة في النظام.`,
          });
        }

        // 🔒 لمن هم غير Dev: يُمنع إعطاء صلاحية لا يمتلكها المنشئ شخصياً
        if (!isBypassUser) {
          const currentUserPermissions: string[] =
            placeAccess?.permissions || [];
          if (!currentUserPermissions.includes(permName)) {
            return res.status(403).json({
              success: false,
              message: `لا يمكنك منح الصلاحية المخصصة [${permName}] لأنك لا تمتلكها.`,
            });
          }
        }

        formattedCustomPermissions.push({
          permission: permName as PlacePermission,
          granted_at: new Date(),
          expires_at: expiresAt,
        });
      }
    }

    // استبعاد الصلاحيات الاستثنائية التي يُغطيها الدور الافتراضي تلقائياً
    const defaultPerms = DEFAULT_ROLE_PERMISSIONS[formattedRole] || [];
    const sanitizedCustomPermissions = formattedCustomPermissions.filter(
      (cp) => !defaultPerms.includes(cp.permission),
    );

    // 3. التحقق من وجود المستخدم المراد إضافته
    const targetUser = await User.findById(user_id);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "المستخدم المراد إضافته غير موجود.",
      });
    }

    // 4. التأكد من عدم وجود تعيين مسبق للمستخدم في هذا المكان
    const existingAccess = await UserPlaceAccess.findOne({
      user_id,
      place_id: new Types.ObjectId(placeId as string),
    });

    if (existingAccess) {
      return res.status(400).json({
        success: false,
        message:
          "هذا المستخدم مضاف بالفعل في هذا المكان. يمكنك تعديل صلاحياته بدلاً من إضافته.",
      });
    }

    // 5. إنشاء سجل الوصول الجديد
    const newAccess = new UserPlaceAccess({
      user_id,
      place_id: placeId,
      role: formattedRole,
      role_expires_at: role_expires_at ? new Date(role_expires_at) : null,
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
        role_expires_at: newAccess.role_expires_at,
        custom_permissions: newAccess.custom_permissions,
        effective_permissions: newAccess.getAllPermissions(),
        inherit_to_children: newAccess.inherit_to_children,
        created_at: (newAccess as any).created_at,
      },
    });
  } catch (error: any) {
    console.error("خطأ في إضافة الموظف:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم أثناء إضافة الموظف.",
      error: error.message,
    });
  }
};

export const updateStaffAccess = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
) => {
  try {
    const { placeId, userId } = req.params;
    const {
      role,
      role_expires_at,
      custom_permissions,
      inherit_to_children,
      transfer_granted_by,
    } = req.body;

    const currentUserId = req.user?._id?.toString();

    // 1. البحث عن سجل صلاحية الموظف المستهدف
    const targetAccess = await UserPlaceAccess.findOne({
      place_id: new Types.ObjectId(placeId as string),
      user_id: new Types.ObjectId(userId as string),
    });

    if (!targetAccess) {
      return res.status(404).json({
        success: false,
        message: "سجل صلاحية الموظف غير موجود في هذا المكان.",
      });
    }

    const isDev = req.user?.role === "dev";

    // 2. القيود الصارمة للمستخدمين العاديين (غير Dev)
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

      // 🔒 منع التعديل على موظف مساوٍ أو أعلى في الرتبة
      if (targetCurrentWeight >= modifierWeight) {
        return res.status(403).json({
          success: false,
          message:
            "لا يمكنك تعديل صلاحيات موظف يملك دوراً مساوياً لدورك أو أعلى منك.",
        });
      }

      // 🔒 منع ترقية الموظف إلى دور مساوٍ أو أعلى من دور المُعدِّل
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

    // 3. تحديث الدور إذا تم إرساله
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

    // 4. تحديث تاريخ انتهاء الدور (role_expires_at)
    if (role_expires_at !== undefined) {
      targetAccess.role_expires_at = role_expires_at
        ? new Date(role_expires_at)
        : null;
    }

    // 5. معالجة وتحديث الصلاحيات المخصصة (custom_permissions) بناءً على السكيمة الجديدة
    if (custom_permissions !== undefined && Array.isArray(custom_permissions)) {
      const validPermissionsList = Object.values(PlacePermission) as string[];

      // تنقيح المدخلات لتكون بنمط ICustomPermission Schema
      const formattedCustomPermissions: ICustomPermission[] = [];

      for (const item of custom_permissions) {
        // إذا أُرسلت الصلاحية كـ string مجرد أو كـ Object { permission, expires_at }
        const permName = typeof item === "string" ? item : item.permission;
        const expiresAt =
          typeof item === "object" && item.expires_at
            ? new Date(item.expires_at)
            : null;

        if (!validPermissionsList.includes(permName)) {
          return res.status(400).json({
            success: false,
            message: `الصلاحية المخصصة [${permName}] غير معرفة في النظام.`,
          });
        }

        // 🔒 للـ Non-Dev: التحقق من أن المُعدِّل يملك هذه الصلاحية بنفسه
        if (!isDev) {
          const modifierPermissions: string[] =
            req.placeAccess?.permissions || [];
          if (!modifierPermissions.includes(permName)) {
            return res.status(403).json({
              success: false,
              message: `لا يمكنك منح الصلاحية المخصصة [${permName}] لأنك لا تمتلكها.`,
            });
          }
        }

        formattedCustomPermissions.push({
          permission: permName as PlacePermission,
          granted_at: new Date(),
          expires_at: expiresAt,
        });
      }

      // استبعاد الصلاحيات المخصصة الزائدة التي يُغطيها الدور الافتراضي للمستخدم
      const activeRole = targetAccess.role as PlaceRole;
      const defaultPerms = DEFAULT_ROLE_PERMISSIONS[activeRole] || [];

      targetAccess.custom_permissions = formattedCustomPermissions.filter(
        (cp) => !defaultPerms.includes(cp.permission),
      );
    }

    // 6. تحديث خاصية التوارث للأبناء
    if (typeof inherit_to_children === "boolean") {
      targetAccess.inherit_to_children = inherit_to_children;
    }

    // 7. الحفظ مع إرجاع البيانات المحدثة
    await targetAccess.save();
    await targetAccess.populate(
      "user_id",
      "first_name last_name email avatar_url role",
    );

    return res.status(200).json({
      success: true,
      message: transfer_granted_by
        ? "تم نقل المنصب وتحديث صلاحيات الموظف بنجاح."
        : "تم تحديث صلاحيات الموظف بنجاح.",
      staff: {
        ...targetAccess.toObject(),
        effective_permissions: targetAccess.getAllPermissions(),
      },
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

export const getStaffPermissions = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
) => {
  try {
    const { placeId, userId } = req.params;

    const access = await UserPlaceAccess.findOne({
      place_id: new Types.ObjectId(placeId as string),
      user_id: new Types.ObjectId(userId as string),
    }).populate("user_id", "first_name last_name email avatar_url role");

    if (!access) {
      return res.status(404).json({
        success: false,
        message: "سجل صلاحيات الموظف غير موجود في هذا المكان.",
      });
    }

    const role = access.role as PlaceRole;
    const now = new Date();

    // فلترة الصلاحيات المخصصة لعرض الصالحة فقط للواجهة الأمامية
    const activeCustomPermissions = (access.custom_permissions || []).filter(
      (cp) => !cp.expires_at || new Date(cp.expires_at) > now,
    );

    return res.status(200).json({
      success: true,
      data: {
        staff_info: access.user_id,
        role: access.role,
        role_expires_at: access.role_expires_at,
        custom_permissions: activeCustomPermissions,
        inherit_to_children: access.inherit_to_children,
        default_permissions: DEFAULT_ROLE_PERMISSIONS[role] || [],
        all_permissions: access.getAllPermissions(), // يستدعي دالة الفلترة الذكية من الموديل
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
    // const isGrantedBy =
    //   targetAccess.granted_by &&
    //   targetAccess.granted_by.toString() === currentUserId;

    // if (isGrantedBy) {
    //   await UserPlaceAccess.findByIdAndDelete(accessId);
    //   return res.status(200).json({
    //     message: "تمت إزالة الموظف بنجاح (بصفتك من قام بمنحه الصلاحية).",
    //   });
    // }

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
      place_id: new Types.ObjectId(placeId as string),
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

export const checkCanCreatePlaceEvent = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
) => {
  try {
    const user = req.user;
    const placeAccess = req.placeAccess;

    if (!user || !placeAccess) {
      return res.status(401).json({
        canCreate: false,
        message: "بيانات الجلسة غير اكتمالية.",
      });
    }

    // 1. استخراج معرف المكان الحالي
    const targetPlaceId = req.params.placeId || req.params.id;

    // 2. تحديد هل يحق للمستخدم إنشاء ندوة وتحديد محاضر آخر (canCreateForOthers)
    const isDev = placeAccess.role === "dev";
    const roleWeight = ROLE_WEIGHTS[placeAccess.role as PlaceRole] || 0;
    const canCreateForOthers = isDev || roleWeight >= 3;

    // 3. جلب قائمة الموظفين المتاحين إذا كان يملك الصلاحية
    let availableInstructors: Array<{
      _id: any;
      first_name: string;
      last_name: string;
      email: string;
      avatar?: string;
    }> = [];

    // أ) جلب المكان المستهدف للوصول لـ ancestors (سلسلة الأجداد والآباء)
    const targetPlace: IPlace | null = await Place.findById(targetPlaceId)
      .select("ancestors name type metadata")
      .lean();
    // console.log(targetPlace);

    if (canCreateForOthers && targetPlaceId) {
      const now = new Date();

      const ancestorsIds = (targetPlace?.ancestors || []).map((id: any) =>
        id.toString(),
      );

      // ب) قائمة جميع الأماكن المطلوبة للبحث (المكان الحالي + الأجداد)
      const placeIdsToSearch = [targetPlaceId.toString(), ...ancestorsIds];

      // ج) استعلام قاعدة البيانات مع تصفية مبدئية لانتهاء الدور + Populate للمستخدم
      const accessRecords = await UserPlaceAccess.find({
        place_id: { $in: placeIdsToSearch },
        $or: [
          { role_expires_at: null },
          { role_expires_at: { $gt: now } }, // الدور ما زال سارياً
        ],
      }).populate<{ user_id: any }>({
        path: "user_id",
        select: "first_name last_name email avatar_url image",
      });

      // د) تصفية السجلات بناءً على قواعد الوراثة وصلاحية إنشاء الندوات
      const validAccessRecords = accessRecords.filter((record) => {
        // console.log(record);
        // التأكد من وجود بيانات المستخدم
        if (!record.user_id) return false;

        const recordPlaceId = record.place_id.toString();
        const isDirectAccess = recordPlaceId === targetPlaceId.toString();

        // شرط الوراثة: إذا لم تكن صلاحية مباشرة، يجب أن تدعم التوارث للأبناء
        if (!isDirectAccess && !record.inherit_to_children) {
          return false;
        }

        // شرط الصلاحية: استخراج الصلاحيات الفعالة والتأكد من وجود صلاحية إنشاء الندوات
        const activePermissions = record.getAllPermissions();
        return activePermissions.includes(PlacePermission.CREATE_EVENT);
      });

      // هـ) إزالة التكرار (في حال كان للموظف أكثر من سجل صلاحية في الأجداد والمكان)
      const uniqueUsersMap = new Map();

      for (const record of validAccessRecords) {
        const u = record.user_id as any;
        const userIdStr = (u._id || u.id).toString();

        if (!uniqueUsersMap.has(userIdStr)) {
          uniqueUsersMap.set(userIdStr, {
            _id: u._id || u.id,
            first_name: u.first_name || "",
            last_name: u.last_name || "",
            email: u.email || "",
            avatar_url: (u as IUser).avatar_url,
          });
        }
      }

      availableInstructors = Array.from(uniqueUsersMap.values());
    }

    const tables = await TopicsTables.find().select("title _id").lean();

    // 4. إرجاع النتيجة للـ Frontend
    return res.status(200).json({
      success: true,
      canCreate: true,
      canCreateForOthers: canCreateForOthers,
      instructors: availableInstructors,
      user: {
        _id: user._id || user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        avatar_url: (user as IUser).avatar_url,
      },
      accessMeta: {
        role: placeAccess.role,
        isInherited: placeAccess.isInherited,
        grantedPlaceId: placeAccess.grantedPlaceId,
      },
      tables,
      place: {
        name: targetPlace?.name || "",
        type: targetPlace?.type || "",
        photo_url: targetPlace?.metadata?.photo_url || "",
      },
    });
  } catch (error: any) {
    console.error("Error in checkCanCreatePlaceEvent:", error);
    return res.status(500).json({
      canCreate: false,
      message: "حدث خطأ في الخادم أثناء معالجة الطلب.",
    });
  }
};

export const createPlaceEvent = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
): Promise<void> => {
  try {
    const { placeId } = req.params;
    // تم التحقق من req.user مسبقاً في الميدل وير
    const userId = req.user?._id || req.user?.id;

    const {
      schedule_name,
      main_topic,
      sub_topic,
      seminars_count,
      location_type,
      external_location_name,
      attendees,
      instructor_info,
      event_date,
    } = req.body;

    // 1️⃣ تحقق من الحقول الأساسية
    if (
      !schedule_name ||
      !main_topic ||
      !sub_topic ||
      !instructor_info ||
      !event_date
    ) {
      res.status(400).json({
        success: false,
        message:
          "يرجى توفير جميع الحقول المطلوبة (اسم الجدول، الموضوع الرئيسي، الموضوع الفرعي، المحاضر، والتاريخ).",
      });
      return;
    }

    // 2️⃣ التحقق من صحة ID المحاضر
    if (!Types.ObjectId.isValid(instructor_info)) {
      res.status(400).json({
        success: false,
        message: "معرّف المحاضر المدخل غير صالح.",
      });
      return;
    }

    // تحديد ما إذا كان نوع الفعالية يتطلب إدخال اسم مكان خارجي
    const requiresExternalLocation =
      location_type === EventLocationType.EXTERNAL_SEMINAR ||
      location_type === EventLocationType.PUBLIC_MEETING ||
      location_type === EventLocationType.CONVOY_SEMINARS;

    // 3️⃣ التحقق من تفاصيل المكان الخارجي
    if (
      requiresExternalLocation &&
      (!external_location_name || !external_location_name.trim())
    ) {
      res.status(400).json({
        success: false,
        message: "اسم المكان الخارجي مطلوب لهذا النوع من الأنشطة.",
      });
      return;
    }

    // 4️⃣ التحقق من أعداد الحضور
    const malesCount = Number(attendees?.males || 0);
    const femalesCount = Number(attendees?.females || 0);
    const childrenCount = Number(attendees?.children || 0);
    const totalAttendeesCalculated = malesCount + femalesCount + childrenCount;

    if (totalAttendeesCalculated <= 0) {
      res.status(400).json({
        success: false,
        message: "لابد أن يكون هناك حضور في الندوة (شخص واحد على الأقل).",
      });
      return;
    }


    let event = await PlaceEvent.findOne({
      place_id: new Types.ObjectId(placeId as string),
      created_by: new Types.ObjectId(userId),
      schedule_name: schedule_name.trim(),
      main_topic: main_topic.trim(),
      sub_topic: sub_topic.trim(),
      location_type: location_type || EventLocationType.INTERNAL_SEMINAR,
      external_location_name: requiresExternalLocation
        ? external_location_name.trim()
        : null,
      instructor_info: new Types.ObjectId(instructor_info),
      event_date: new Date(event_date),
    });

    if (event) {
      // console.log("old");
      event.seminars_count += Number(seminars_count);
      event.attendees.children += childrenCount;
      event.attendees.females += femalesCount;
      event.attendees.males += malesCount;
      await event.save();
    } else {
      // console.log("new");
      event = await PlaceEvent.create({
        place_id: new Types.ObjectId(placeId as string),
        created_by: new Types.ObjectId(userId),
        schedule_name: schedule_name.trim(),
        main_topic: main_topic.trim(),
        sub_topic: sub_topic.trim(),
        seminars_count: Number(seminars_count) || 1,
        location_type: location_type || EventLocationType.INTERNAL_SEMINAR,
        external_location_name: requiresExternalLocation
          ? external_location_name.trim()
          : null,
        attendees: {
          males: malesCount,
          females: femalesCount,
          children: childrenCount,
        },
        instructor_info: new Types.ObjectId(instructor_info),
        event_date: new Date(event_date),
      });
    }

    // 5️⃣ حفظ البيانات في الداتابيز

    res.status(201).json({
      success: true,
      message: "تم حفظ الندوة بنجاح.",
      data: event,
    });
  } catch (error: any) {
    console.error("خطأ أثناء حفظ الندوة:", error);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map(
        (val: any) => val.message,
      );
      res.status(400).json({
        success: false,
        message: messages.join(" | "),
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: "حدث خطأ في الخادم أثناء حفظ البيانات.",
      error: error.message,
    });
  }
};

//

export const checkPlacePlanAccess = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
) => {
  try {
    const placeId = String(req.params.placeId || "");

    // 1. البيانات تم التأكد من صحتها وصلاحياتها بواسطة الميدلوير authorizePermission
    const placeAccess = req.placeAccess;

    if (!placeAccess) {
      return res.status(403).json({
        can_create: false,
        message: "عذراً، لم يتم العثور على صلاحيات مرتبطة بهذا المكان.",
      });
    }

    // 2. جلب كافة جداول الموضوعات المسجلة من قاعدة البيانات
    const tables = await TopicsTables.find({}).lean();

    // 3. تحويل وتجهيز البيانات المتوافقة مع الـ Schema
    const formattedSchedules = tables.map((table: any) => {
      // تجميع المواضيع الفرعية المتاحة بحسب كل موضوع رئيسي داخل الجدول
      const rows = table.table_rows || [];

      // تجميع المواضيع الفرعية المقترنة بالمواضيع الرئيسية
      const topicsGrouped: { [key: string]: string[] } = {};

      rows.forEach((row: any) => {
        if (row.mainTopic && row.supTopic) {
          if (!topicsGrouped[row.mainTopic]) {
            topicsGrouped[row.mainTopic] = [];
          }
          topicsGrouped[row.mainTopic]!.push(row.supTopic);
        }
      });

      // إخراج قائمة مبسطة من المصفوفة
      const allSubTopics = rows.map((r: any) => r.supTopic).filter(Boolean);
      const firstMainTopic = rows.length > 0 ? rows[0].mainTopic : "";

      return {
        schedule_name: table.title, // عنوان الجدول (title)
        description: table.description,
        main_topic: firstMainTopic, // الموضوع الرئيسي الأولي
        sub_topics: allSubTopics, // المواضيع الفرعية (supTopic)
        rows: rows.map((r: any) => ({
          mainTopic: r.mainTopic,
          supTopic: r.supTopic,
        })),
      };
    });

    // 4. إرجاع الرد
    return res.status(200).json({
      can_create: true,
      message: "المستخدم مؤهل لإنشاء خطة لهذا المكان.",
      user_role: placeAccess.role,
      is_inherited_permission: placeAccess.isInherited,
      granted_from_place_id: placeAccess.grantedPlaceId,
      available_schedules: formattedSchedules,
    });
  } catch (error: any) {
    console.error("Error in checkPlacePlanAccess:", error);
    return res.status(500).json({
      can_create: false,
      message: "حدث خطأ في السيرفر أثناء جلب بيانات التخطيط.",
      error: error.message,
    });
  }
};

export const saveDraftPlans = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { seminars } = req.body;
    const placeId = req.params.placeId;

    // الحصول على ID المستخدم من middleware المصادقة
    const created_by = req.user?._id;

    if (
      typeof placeId !== "string" ||
      !Types.ObjectId.isValid(placeId) ||
      !created_by
    ) {
      res.status(400).json({
        success: false,
        message: "معرف المكان أو المستخدم غير صالح.",
      });
      return;
    }

    if (!Array.isArray(seminars) || seminars.length === 0) {
      res.status(400).json({
        success: false,
        message: "يجب إرسال ندوة واحدة على الأقل للحفظ.",
      });
      return;
    }

    // تجهيز مصفوفة المستندات للإدراج دفعة واحدة
    const plansToInsert = seminars.map((seminar) => {
      const males = Number(seminar.target_attendees?.males || 0);
      const females = Number(seminar.target_attendees?.females || 0);
      const children = Number(seminar.target_attendees?.children || 0);

      return {
        place_id: new Types.ObjectId(placeId),
        created_by,
        schedule_name: seminar.schedule_name,
        main_topic: seminar.main_topic,
        sub_topic: seminar.sub_topic,
        planned_date: new Date(seminar.planned_date),
        location_type: seminar.location_type,
        external_location_name:
          seminar.location_type === "external_seminar" ||
          seminar.location_type === "public_meeting" ||
          seminar.location_type === "convoy_seminars"
            ? seminar.external_location_name
            : null,
        media_outlets_count: Number(seminar.media_outlets_count || 0),
        digital_media_activities_count: Number(
          seminar.digital_media_activities_count || 0,
        ),
        target_attendees: { males, females, children },
        target_total_attendees: males + females + children,
        // استقبال عدد الندوات المستهدفة لكل بند مباشرة من الـ Frontend
        target_seminars_count: Number(
          seminar.target_seminars_count || seminar.count || 1,
        ),
        status: PlanStatus.DRAFT,
      };
    });

    // إدخال كل العناصر دفعة واحدة في قاعدة البيانات مع تشغيل validation و hooks
    const savedPlans = await PlacePlan.insertMany(plansToInsert);

    res.status(201).json({
      success: true,
      message: `تم حفظ الخطة بنجاح! (عدد الصفوف المدرجة: ${savedPlans.length})`,
      data: savedPlans,
    });
  } catch (error: any) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map(
        (err: any) => err.message,
      );
      res.status(422).json({
        success: false,
        message: messages.join(" | "),
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: "حدث خطأ في السيرفر أثناء حفظ الخطة كمسودة.",
      error: error.message,
    });
  }
};

//

export const getDraftsPlans = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const { placeId } = req.params;
    const userId = req.user?._id;

    if (!Types.ObjectId.isValid(placeId as string)) {
      return res.status(400).json({
        success: false,
        message: "رمز المكان غير صالح",
      });
    }

    // جلب المسودات والجداول بالتوازي لرفع الأداء (Performance Optimization)
    const [draftsDocs, tabels] = await Promise.all([
      PlacePlan.find({
        place_id: new Types.ObjectId(placeId as string),
        created_by: new Types.ObjectId(userId),
        status: PlanStatus.DRAFT,
      })
        .sort({ planned_date: 1, created_at: -1 })
        .lean(),
      TopicsTables.find().lean(),
    ]);

    // تحويل صيغة البيانات المجلوبة لتتوافق تماماً مع الواجهة الأمامية (IGroupedSeminar)
    const formattedDrafts = draftsDocs.map((draft: any) => ({
      id: draft._id.toString(),
      schedule_name: draft.schedule_name,
      main_topic: draft.main_topic,
      sub_topic: draft.sub_topic,
      planned_date: draft.planned_date
        ? new Date(draft.planned_date).toISOString().split("T")[0]
        : "",
      location_type: draft.location_type,
      external_location_name: draft.external_location_name || "",
      media_outlets_count: draft.media_outlets_count || 0,
      digital_media_activities_count: draft.digital_media_activities_count || 0,
      target_attendees: draft.target_attendees || {
        males: 0,
        females: 0,
        children: 0,
      },
      count: draft.target_seminars_count || 1,
    }));

    return res.status(200).json({
      success: true,
      count: formattedDrafts.length,
      data: formattedDrafts,
      tabels,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب المسودات",
      error: error.message,
    });
  }
};

export const updateDraftPlan = async (req: Request, res: Response) => {
  try {
    const { placeId, planId } = req.params;
    const { action, count, ...updateData } = req.body;
    const userId = req.user?._id;

    // توحيد الحقل القادم من الفرونت (سواء كان count أو target_seminars_count)
    const seminarsCount = count ?? updateData.target_seminars_count;

    const isNew = planId === "new" || action === "CREATE";

    // دالة مساعدة لتوحيد شكل البيانات المرجعة للفرونت إند
    const formatResponseData = (doc: any) => {
      const plainObj = doc.toObject ? doc.toObject() : doc;
      return {
        ...plainObj,
        id: plainObj._id.toString(),
        count: plainObj.target_seminars_count ?? 1,
      };
    };

    // ==========================================
    // 1. سيناريو إضافة صف جديد
    // ==========================================
    if (isNew) {
      if (!placeId) {
        return res.status(400).json({
          success: false,
          message: "معرف المكان (placeId) مطلوب لإضافة صف جديد",
        });
      }

      const externalLocation =
        updateData.location_type === "external_seminar" ||
        updateData.location_type === "public_meeting" ||
        updateData.location_type === "convoy_seminars"
          ? updateData.external_location_name
          : null;

      const existingMatchingPlan = await PlacePlan.findOne({
        place_id: placeId,
        created_by: new Types.ObjectId(userId),
        schedule_name: updateData.schedule_name,
        main_topic: updateData.main_topic,
        sub_topic: updateData.sub_topic,
        location_type: updateData.location_type,
        external_location_name: externalLocation,
        planned_date: updateData.planned_date,
        status: { $in: [PlanStatus.DRAFT] },
      });

      if (existingMatchingPlan) {
        existingMatchingPlan.target_seminars_count += seminarsCount || 1;

        existingMatchingPlan.media_outlets_count =
          (existingMatchingPlan.media_outlets_count || 0) +
          (updateData.media_outlets_count || 0);

        existingMatchingPlan.digital_media_activities_count =
          (existingMatchingPlan.digital_media_activities_count || 0) +
          (updateData.digital_media_activities_count || 0);

        if (updateData.target_attendees) {
          existingMatchingPlan.target_attendees = {
            males:
              (existingMatchingPlan.target_attendees?.males || 0) +
              (updateData.target_attendees.males || 0),
            females:
              (existingMatchingPlan.target_attendees?.females || 0) +
              (updateData.target_attendees.females || 0),
            children:
              (existingMatchingPlan.target_attendees?.children || 0) +
              (updateData.target_attendees.children || 0),
          };
        }

        existingMatchingPlan.target_total_attendees =
          (existingMatchingPlan.target_attendees.males || 0) +
          (existingMatchingPlan.target_attendees.females || 0) +
          (existingMatchingPlan.target_attendees.children || 0);

        await existingMatchingPlan.save();

        return res.status(200).json({
          success: true,
          message: "تم دمج الفعالية الجديدة مع صف مطابق موجود بالفعل",
          action: "MERGED",
          data: formatResponseData(existingMatchingPlan),
        });
      }

      const totalAttendees =
        (updateData.target_attendees?.males || 0) +
        (updateData.target_attendees?.females || 0) +
        (updateData.target_attendees?.children || 0);

      const newPlan = new PlacePlan({
        created_by: new Types.ObjectId(userId),
        place_id: placeId,
        schedule_name: updateData.schedule_name,
        main_topic: updateData.main_topic,
        sub_topic: updateData.sub_topic,
        target_seminars_count: seminarsCount || 1,
        planned_date: updateData.planned_date,
        location_type: updateData.location_type,
        external_location_name: externalLocation,
        media_outlets_count: updateData.media_outlets_count || 0,
        digital_media_activities_count:
          updateData.digital_media_activities_count || 0,
        target_attendees: updateData.target_attendees || {
          males: 0,
          females: 0,
          children: 0,
        },
        target_total_attendees: totalAttendees,
        status: PlanStatus.DRAFT,
      });

      await newPlan.save();

      return res.status(201).json({
        success: true,
        message: "تمت إضافة الصف الجديد بنجاح",
        action: "CREATED",
        data: formatResponseData(newPlan),
      });
    }

    // ==========================================
    // 2. البحث عن الصف الحالي
    // ==========================================
    const currentPlan = await PlacePlan.findById(planId);

    if (!currentPlan) {
      return res.status(404).json({
        success: false,
        message: "لم يتم العثور على الخطة المطلوبة",
      });
    }

    if (currentPlan.status !== PlanStatus.DRAFT) {
      return res.status(400).json({
        success: false,
        message: "لا يمكن تعديل أو حذف خطة غير مأرشفة",
      });
    }

    // ==========================================
    // 3. سيناريو الحذف
    // ==========================================
    if (action === "DELETE" || seminarsCount === 0) {
      await PlacePlan.findOneAndDelete({
        _id: new Types.ObjectId(planId as string),
        created_by: new Types.ObjectId(userId),
      });
      return res.status(200).json({
        success: true,
        message: "تم حذف صف الخطة بنجاح",
        action: "DELETED",
      });
    }

    // ==========================================
    // 4. سيناريو التعديل والدمج
    // ==========================================
    const targetScheduleName =
      updateData.schedule_name ?? currentPlan.schedule_name;
    const targetMainTopic = updateData.main_topic ?? currentPlan.main_topic;
    const targetSubTopic = updateData.sub_topic ?? currentPlan.sub_topic;
    const targetLocationType =
      updateData.location_type ?? currentPlan.location_type;

    const targetExternalLocation =
      targetLocationType === "external_seminar" ||
      targetLocationType === "convoy_seminars" ||
      targetLocationType === "public_meeting"
        ? (updateData.external_location_name ??
          currentPlan.external_location_name)
        : null;

    const targetPlannedDate =
      updateData.planned_date ?? currentPlan.planned_date;

    const existingMatchingPlan = await PlacePlan.findOne({
      _id: { $ne: new Types.ObjectId(planId as string) },
      place_id: currentPlan.place_id,
      schedule_name: targetScheduleName,
      main_topic: targetMainTopic,
      sub_topic: targetSubTopic,
      location_type: targetLocationType,
      external_location_name: targetExternalLocation,
      planned_date: targetPlannedDate,
      status: { $in: [PlanStatus.DRAFT, PlanStatus.REJECTED] },
    });

    if (existingMatchingPlan) {
      const addedSeminarsCount =
        seminarsCount ?? currentPlan.target_seminars_count;
      const addedAttendees =
        updateData.target_attendees || currentPlan.target_attendees;

      const addedMediaOutlets =
        updateData.media_outlets_count ?? currentPlan.media_outlets_count ?? 0;
      const addedDigitalMedia =
        updateData.digital_media_activities_count ??
        currentPlan.digital_media_activities_count ??
        0;

      existingMatchingPlan.target_seminars_count += addedSeminarsCount;
      existingMatchingPlan.media_outlets_count =
        (existingMatchingPlan.media_outlets_count || 0) + addedMediaOutlets;
      existingMatchingPlan.digital_media_activities_count =
        (existingMatchingPlan.digital_media_activities_count || 0) +
        addedDigitalMedia;

      if (addedAttendees) {
        existingMatchingPlan.target_attendees = {
          males:
            (existingMatchingPlan.target_attendees?.males || 0) +
            (addedAttendees.males || 0),
          females:
            (existingMatchingPlan.target_attendees?.females || 0) +
            (addedAttendees.females || 0),
          children:
            (existingMatchingPlan.target_attendees?.children || 0) +
            (addedAttendees.children || 0),
        };
      }

      existingMatchingPlan.target_total_attendees =
        (existingMatchingPlan.target_attendees.males || 0) +
        (existingMatchingPlan.target_attendees.females || 0) +
        (existingMatchingPlan.target_attendees.children || 0);

      await existingMatchingPlan.save();
      await PlacePlan.findByIdAndDelete(planId);

      return res.status(200).json({
        success: true,
        message: "تم دمج بيانات الصف مع صف آخر مطابق بنجاح",
        action: "MERGED",
        data: formatResponseData(existingMatchingPlan),
      });
    }

    // ==========================================
    // 5. سيناريو التحديث العادي
    // ==========================================
    if (updateData.schedule_name !== undefined)
      currentPlan.schedule_name = updateData.schedule_name;
    if (updateData.main_topic !== undefined)
      currentPlan.main_topic = updateData.main_topic;
    if (updateData.sub_topic !== undefined)
      currentPlan.sub_topic = updateData.sub_topic;
    if (seminarsCount !== undefined)
      currentPlan.target_seminars_count = seminarsCount;
    if (updateData.planned_date !== undefined)
      currentPlan.planned_date = updateData.planned_date;
    if (updateData.location_type !== undefined)
      currentPlan.location_type = updateData.location_type;

    currentPlan.external_location_name =
      currentPlan.location_type === "external_seminar" ||
      currentPlan.location_type === "public_meeting" ||
      currentPlan.location_type === "convoy_seminars"
        ? (updateData.external_location_name ??
          currentPlan.external_location_name)
        : null;

    if (updateData.media_outlets_count !== undefined)
      currentPlan.media_outlets_count = updateData.media_outlets_count;
    if (updateData.digital_media_activities_count !== undefined)
      currentPlan.digital_media_activities_count =
        updateData.digital_media_activities_count;

    if (updateData.target_attendees !== undefined) {
      currentPlan.target_attendees = updateData.target_attendees;
      currentPlan.target_total_attendees =
        (updateData.target_attendees.males || 0) +
        (updateData.target_attendees.females || 0) +
        (updateData.target_attendees.children || 0);
    }

    await currentPlan.save();

    return res.status(200).json({
      success: true,
      message: "تم حفظ التعديلات بنجاح",
      action: "UPDATED",
      data: formatResponseData(currentPlan),
    });
  } catch (error: any) {
    console.log(error.message);
    return res.status(400).json({
      success: false,
      message: error.message || "حدث خطأ أثناء تحديث الخطة",
    });
  }
};
// 3. إرسال كافة المسودات الخاصة بالمكان للمراجعة (POST /api/place-plans/submit-review/:place_id)
export const submitToPreReview = async (req: Request, res: Response) => {
  try {
    const { place_id } = req.params;
    const userId = req.user?._id;

    if (typeof place_id !== "string") {
      return res.status(400).json({
        success: false,
        message: "معرّف المكان غير صالح",
      });
    }

    const result = await PlacePlan.updateMany(
      {
        place_id,
        created_by: new Types.ObjectId(userId),
        status: PlanStatus.DRAFT,
      },
      {
        $set: { status: PlanStatus.PENDING_REVIEW },
      },
    );
    // في حال عدم وجود أي سجلات مسودة جرى تحديثها
    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "لا توجد موضوعات بحالة مسودة (draft) متاحة للرفع والإعتماد.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "تمت إحالة جميع المسودات للمراجعة بنجاح",
      modifiedCount: result.modifiedCount,
    });
  } catch (error: any) {
    console.log(error.message);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إرسال المسودات للمراجعة",
      error: error.message,
    });
  }
};

//

export const get_pending_reviews = async (req: Request, res: Response) => {
  try {
    const { place_id } = req.query;

    const queryFilter: any = {
      status: PlanStatus.PENDING_REVIEW,
    };

    if (place_id) {
      queryFilter.place_id = place_id;
    }

    // 1. جلب الخطط المعلقة
    const pendingPlans = await PlacePlan.find(queryFilter)
      .populate("created_by", "first_name last_name email avatar_url")
      .populate("instructor_info", "first_name last_name email avatar_url")
      .populate("place_id", "name")
      .sort({ planned_date: 1 })
      .lean();

    // 2. جلب جداول الموضوعات للاستفادة من ألوان وتفاصيل التنسيق في الواجهة
    const topicsTables = await TopicsTables.find().lean();

    return res.status(200).json({
      success: true,
      data: {
        plans: pendingPlans,
        topicsTables: topicsTables,
      },
    });
  } catch (error: any) {
    console.log(error.message);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب ملفات الخطط والموضوعات",
      error: error.message,
    });
  }
};

export const adminUpdatePendingPlan = async (req: Request, res: Response) => {
  try {
    const { placeId, planId } = req.params;
    const { action, count, ...updateData } = req.body;
    const adminUserId = req.user?._id; // ID الشخص المسؤول عن الاعتماد/التعديل

    // توحيد الحقل القادم من الفرونت (سواء كان count أو target_seminars_count)
    const seminarsCount = count ?? updateData.target_seminars_count;

    const isNew = planId === "new" || action === "CREATE";

    // دالة مساعدة لتوحيد شكل البيانات المرجعة للفرونت إند
    const formatResponseData = (doc: any) => {
      const plainObj = doc.toObject ? doc.toObject() : doc;
      return {
        ...plainObj,
        id: plainObj._id.toString(),
        count: plainObj.target_seminars_count ?? 1,
      };
    };

    // ==========================================
    // 1. سيناريو إضافة صف جديد بواسطة المعتمد
    // ==========================================
    if (isNew) {
      if (!placeId) {
        return res.status(400).json({
          success: false,
          message: "معرف المكان (placeId) مطلوب لإضافة صف جديد",
        });
      }

      // إمكانية تحديد الموظف صاحب الخطة إذا تم تمريره، أو تعيين المعتمد نفسه
      const targetUserId = updateData.created_by || adminUserId;

      const externalLocation =
        updateData.location_type === "external_seminar" ||
        updateData.location_type === "public_meeting" ||
        updateData.location_type === "convoy_seminars"
          ? updateData.external_location_name
          : null;

      // البحث عن صف مطابق معلق لنفس الموظف
      const existingMatchingPlan = await PlacePlan.findOne({
        place_id: placeId,
        created_by: new Types.ObjectId(targetUserId),
        schedule_name: updateData.schedule_name,
        main_topic: updateData.main_topic,
        sub_topic: updateData.sub_topic,
        location_type: updateData.location_type,
        external_location_name: externalLocation,
        planned_date: updateData.planned_date,
        status: { $in: [PlanStatus.PENDING_REVIEW] },
      });

      if (existingMatchingPlan) {
        existingMatchingPlan.target_seminars_count += seminarsCount || 1;

        existingMatchingPlan.media_outlets_count =
          (existingMatchingPlan.media_outlets_count || 0) +
          (updateData.media_outlets_count || 0);

        existingMatchingPlan.digital_media_activities_count =
          (existingMatchingPlan.digital_media_activities_count || 0) +
          (updateData.digital_media_activities_count || 0);

        if (updateData.target_attendees) {
          existingMatchingPlan.target_attendees = {
            males:
              (existingMatchingPlan.target_attendees?.males || 0) +
              (updateData.target_attendees.males || 0),
            females:
              (existingMatchingPlan.target_attendees?.females || 0) +
              (updateData.target_attendees.females || 0),
            children:
              (existingMatchingPlan.target_attendees?.children || 0) +
              (updateData.target_attendees.children || 0),
          };
        }

        existingMatchingPlan.target_total_attendees =
          (existingMatchingPlan.target_attendees.males || 0) +
          (existingMatchingPlan.target_attendees.females || 0) +
          (existingMatchingPlan.target_attendees.children || 0);

        await existingMatchingPlan.save();

        return res.status(200).json({
          success: true,
          message: "تم دمج الفعالية الجديدة مع صف مطابق موجود بالفعل",
          action: "MERGED",
          data: formatResponseData(existingMatchingPlan),
        });
      }

      const totalAttendees =
        (updateData.target_attendees?.males || 0) +
        (updateData.target_attendees?.females || 0) +
        (updateData.target_attendees?.children || 0);

      const newPlan = new PlacePlan({
        created_by: new Types.ObjectId(targetUserId),
        place_id: placeId,
        schedule_name: updateData.schedule_name,
        main_topic: updateData.main_topic,
        sub_topic: updateData.sub_topic,
        target_seminars_count: seminarsCount || 1,
        planned_date: updateData.planned_date,
        location_type: updateData.location_type,
        external_location_name: externalLocation,
        media_outlets_count: updateData.media_outlets_count || 0,
        digital_media_activities_count:
          updateData.digital_media_activities_count || 0,
        target_attendees: updateData.target_attendees || {
          males: 0,
          females: 0,
          children: 0,
        },
        target_total_attendees: totalAttendees,
        status: PlanStatus.PENDING_REVIEW, // إنشاء الخطة مباشرة في حالة قيد الانتظار/المراجعة
      });

      await newPlan.save();

      return res.status(201).json({
        success: true,
        message: "تمت إضافة الصف الجديد بنجاح",
        action: "CREATED",
        data: formatResponseData(newPlan),
      });
    }

    // ==========================================
    // 2. البحث عن الصف الحالي المراد تعديله أو حذفه
    // ==========================================
    const currentPlan = await PlacePlan.findById(planId);

    if (!currentPlan) {
      return res.status(404).json({
        success: false,
        message: "لم يتم العثور على الخطة المطلوبة",
      });
    }

    // المعتمد يمنع فقط من تعديل الخطط المقبولة/المعتمدة بالفعل (APPROVED)
    if (currentPlan.status !== PlanStatus.PENDING_REVIEW) {
      return res.status(400).json({
        success: false,
        message: "لا يمكن تعديل أو حذف خطة معتمدة أو مسودة غير مرفوعة للمراجعة",
      });
    }

    // ==========================================
    // 3. سيناريو الحذف بواسطة المعتمد
    // ==========================================
    if (action === "DELETE" || seminarsCount === 0) {
      await PlacePlan.findByIdAndDelete(planId);
      return res.status(200).json({
        success: true,
        message: "تم حذف صف الخطة بنجاح بواسطة المعتمد",
        action: "DELETED",
      });
    }

    // ==========================================
    // 4. سيناريو التعديل والدمج بواسطة المعتمد
    // ==========================================
    const targetScheduleName =
      updateData.schedule_name ?? currentPlan.schedule_name;
    const targetMainTopic = updateData.main_topic ?? currentPlan.main_topic;
    const targetSubTopic = updateData.sub_topic ?? currentPlan.sub_topic;
    const targetLocationType =
      updateData.location_type ?? currentPlan.location_type;

    const targetExternalLocation =
      targetLocationType === "external_seminar" ||
      targetLocationType === "public_meeting" ||
      targetLocationType === "convoy_seminars"
        ? (updateData.external_location_name ??
          currentPlan.external_location_name)
        : null;

    const targetPlannedDate =
      updateData.planned_date ?? currentPlan.planned_date;

    // البحث عن خطة مطابقة لنفس الموظف صاحب الخطة الأصلي
    const existingMatchingPlan = await PlacePlan.findOne({
      _id: { $ne: new Types.ObjectId(planId as string) },
      place_id: currentPlan.place_id,
      created_by: currentPlan.created_by, // الحفاظ على دمج خطط نفس الموظف
      schedule_name: targetScheduleName,
      main_topic: targetMainTopic,
      sub_topic: targetSubTopic,
      location_type: targetLocationType,
      external_location_name: targetExternalLocation,
      planned_date: targetPlannedDate,
      status: {
        $in: [PlanStatus.PENDING_REVIEW],
      },
    });

    if (existingMatchingPlan) {
      const addedSeminarsCount =
        seminarsCount ?? currentPlan.target_seminars_count;
      const addedAttendees =
        updateData.target_attendees || currentPlan.target_attendees;

      const addedMediaOutlets =
        updateData.media_outlets_count ?? currentPlan.media_outlets_count ?? 0;
      const addedDigitalMedia =
        updateData.digital_media_activities_count ??
        currentPlan.digital_media_activities_count ??
        0;

      existingMatchingPlan.target_seminars_count += addedSeminarsCount;
      existingMatchingPlan.media_outlets_count =
        (existingMatchingPlan.media_outlets_count || 0) + addedMediaOutlets;
      existingMatchingPlan.digital_media_activities_count =
        (existingMatchingPlan.digital_media_activities_count || 0) +
        addedDigitalMedia;

      if (addedAttendees) {
        existingMatchingPlan.target_attendees = {
          males:
            (existingMatchingPlan.target_attendees?.males || 0) +
            (addedAttendees.males || 0),
          females:
            (existingMatchingPlan.target_attendees?.females || 0) +
            (addedAttendees.females || 0),
          children:
            (existingMatchingPlan.target_attendees?.children || 0) +
            (addedAttendees.children || 0),
        };
      }

      existingMatchingPlan.target_total_attendees =
        (existingMatchingPlan.target_attendees.males || 0) +
        (existingMatchingPlan.target_attendees.females || 0) +
        (existingMatchingPlan.target_attendees.children || 0);

      await existingMatchingPlan.save();
      await PlacePlan.findByIdAndDelete(planId);

      return res.status(200).json({
        success: true,
        message: "تم دمج بيانات الصف مع صف آخر مطابق بنجاح",
        action: "MERGED",
        data: formatResponseData(existingMatchingPlan),
      });
    }

    // ==========================================
    // 5. سيناريو التحديث العادي بواسطة المعتمد
    // ==========================================
    if (updateData.schedule_name !== undefined)
      currentPlan.schedule_name = updateData.schedule_name;
    if (updateData.main_topic !== undefined)
      currentPlan.main_topic = updateData.main_topic;
    if (updateData.sub_topic !== undefined)
      currentPlan.sub_topic = updateData.sub_topic;
    if (seminarsCount !== undefined)
      currentPlan.target_seminars_count = seminarsCount;
    if (updateData.planned_date !== undefined)
      currentPlan.planned_date = updateData.planned_date;
    if (updateData.location_type !== undefined)
      currentPlan.location_type = updateData.location_type;

    currentPlan.external_location_name =
      currentPlan.location_type === "external_seminar" ||
      currentPlan.location_type === "public_meeting" ||
      currentPlan.location_type === "convoy_seminars"
        ? (updateData.external_location_name ??
          currentPlan.external_location_name)
        : null;

    if (updateData.media_outlets_count !== undefined)
      currentPlan.media_outlets_count = updateData.media_outlets_count;
    if (updateData.digital_media_activities_count !== undefined)
      currentPlan.digital_media_activities_count =
        updateData.digital_media_activities_count;

    if (updateData.target_attendees !== undefined) {
      currentPlan.target_attendees = updateData.target_attendees;
      currentPlan.target_total_attendees =
        (updateData.target_attendees.males || 0) +
        (updateData.target_attendees.females || 0) +
        (updateData.target_attendees.children || 0);
    }

    await currentPlan.save();

    return res.status(200).json({
      success: true,
      message: "تم حفظ التعديلات بواسطة المعتمد بنجاح",
      action: "UPDATED",
      data: formatResponseData(currentPlan),
    });
  } catch (error: any) {
    console.log("Error in adminUpdatePendingPlan:", error.message);
    return res.status(400).json({
      success: false,
      message: error.message || "حدث خطأ أثناء تحديث الخطة بواسطة المعتمد",
    });
  }
};

export const approve_place_plans = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
) => {
  try {
    const { placeId } = req.params;
    const { userIdToApprove } = req.body; // اختياري: إذا أُرسل يتم اعتماد خطط هذا الموظف فقط، وإذا لم يُرسل يتم اعتماد كافة خطط المكان المعلقة
    const reviewerId = req.user?._id || req.user?.id;

    if (!placeId) {
      return res
        .status(400)
        .json({ success: false, message: "معرف المكان (placeId) مطلوب." });
    }

    // 1. تحديد شروط البحث للخطط غير المعتمدة (pending_review أو draft)
    const pendingQuery: any = {
      place_id: placeId,
      status: { $in: [PlanStatus.PENDING_REVIEW] },
    };

    if (userIdToApprove) {
      pendingQuery.created_by = userIdToApprove;
    }

    // جلب جميع الخطط المعلقة المراد اعتمادها
    const pendingPlans = await PlacePlan.find(pendingQuery);

    if (!pendingPlans || pendingPlans.length === 0) {
      return res.status(404).json({
        success: false,
        message: "لا توجد خطط معلقة قيد المراجعة للاعتماد.",
      });
    }

    // ------------------------------------------------------------------------
    // 💡 التحسين: حساب أقصى وأقل تاريخ لتحديد الفترة الزمنية للخطط المعلقة
    // ------------------------------------------------------------------------
    const timestamps = pendingPlans
      .map((p) => new Date(p.planned_date).getTime())
      .filter((t) => !isNaN(t));

    const minTimestamp = Math.min(...timestamps);
    const maxTimestamp = Math.max(...timestamps);

    // بداية تاريخ اليوم لأصغر تاريخ (00:00:00)
    const startDate = new Date(minTimestamp);
    startDate.setHours(0, 0, 0, 0);

    // نهاية تاريخ اليوم لأكبر تاريخ (23:59:59.999)
    const endDate = new Date(maxTimestamp);
    endDate.setHours(23, 59, 59, 999);

    // 2. جلب الخطط المعتمدة سابقاً المحصورة *فقط* بين فترة البداية والنهاية
    const existingApprovedPlans = await PlacePlan.find({
      place_id: placeId,
      status: PlanStatus.APPROVED,
      planned_date: {
        $gte: startDate,
        $lte: endDate,
      },
    });

    // إنشاء مفتاح فريد لتمييز التفاصيل المتطابقة للموضوع والجدول والنوع والتاريخ
    const generateKey = (plan: any) => {
      let dateStr = "";
      if (plan.planned_date) {
        const d = new Date(plan.planned_date);
        // استخراج السنة والشهر واليوم بالتوقيت المحلي لضمان عدم تأثر التاريخ بفارق الساعات
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        dateStr = `${year}-${month}-${day}`;
      }
      const extLoc = plan.external_location_name?.trim() || "";
      return `${plan.schedule_name?.trim()}_${plan.main_topic?.trim()}_${plan.sub_topic?.trim()}_${plan.location_type}_${extLoc}_${dateStr}`;
    };

    // خريطة لتجميع البيانات المدمجة
    // Map<Key, { docToUpdate?: IPlacePlan, isNew: boolean, data: Partial<IPlacePlan> }>
    const mapToProcess = new Map<string, any>();

    // أ) تعبئة الخريطة بالخطط المعتمدة سابقاً كمرجع أول
    for (const approvedPlan of existingApprovedPlans) {
      const key = generateKey(approvedPlan);
      mapToProcess.set(key, {
        docToUpdate: approvedPlan, // وثيقة موجودة بالفعل في داتابيز
        isNew: false,
        data: {
          target_seminars_count: approvedPlan.target_seminars_count || 0,
          media_outlets_count: approvedPlan.media_outlets_count || 0,
          digital_media_activities_count:
            approvedPlan.digital_media_activities_count || 0,
          target_attendees: {
            males: approvedPlan.target_attendees?.males || 0,
            females: approvedPlan.target_attendees?.females || 0,
            children: approvedPlan.target_attendees?.children || 0,
          },
          merged_from_ids: approvedPlan.merged_from_ids
            ? [...approvedPlan.merged_from_ids]
            : [],
        },
      });
    }

    // ب) معالجة ودمج الخطط المعلقة الحالية
    for (const pendingPlan of pendingPlans) {
      const key = generateKey(pendingPlan);

      if (mapToProcess.has(key)) {
        // يوجد موضوع مطابق (إما خطة معتمدة سابقة أو خطة معلقة تم حسابها في هذه الدورة)
        const item = mapToProcess.get(key);

        item.data.target_seminars_count +=
          pendingPlan.target_seminars_count || 1;
        item.data.media_outlets_count += pendingPlan.media_outlets_count || 0;
        item.data.digital_media_activities_count +=
          pendingPlan.digital_media_activities_count || 0;

        item.data.target_attendees.males +=
          pendingPlan.target_attendees?.males || 0;
        item.data.target_attendees.females +=
          pendingPlan.target_attendees?.females || 0;
        item.data.target_attendees.children +=
          pendingPlan.target_attendees?.children || 0;

        // إضافة المعرف إلى مصفوفة سجل الدمج
        if (!item.data.merged_from_ids.includes(pendingPlan._id)) {
          item.data.merged_from_ids.push(pendingPlan._id);
        }
      } else {
        // لا يوجد موضوع مطابق سابق، ينشأ إدخال جديد معتمد
        mapToProcess.set(key, {
          docToUpdate: null,
          isNew: true,
          originalPlan: pendingPlan,
          data: {
            place_id: pendingPlan.place_id,
            created_by: pendingPlan.created_by,
            schedule_name: pendingPlan.schedule_name,
            main_topic: pendingPlan.main_topic,
            sub_topic: pendingPlan.sub_topic,
            location_type: pendingPlan.location_type,
            external_location_name: pendingPlan.external_location_name,
            planned_date: pendingPlan.planned_date,
            instructor_info: pendingPlan.instructor_info,
            target_seminars_count: pendingPlan.target_seminars_count || 1,
            media_outlets_count: pendingPlan.media_outlets_count || 0,
            digital_media_activities_count:
              pendingPlan.digital_media_activities_count || 0,
            target_attendees: {
              males: pendingPlan.target_attendees?.males || 0,
              females: pendingPlan.target_attendees?.females || 0,
              children: pendingPlan.target_attendees?.children || 0,
            },
            merged_from_ids: [pendingPlan._id],
          },
        });
      }
    }

    // 3. تطبيق التعديلات وإنشاء الوثائق المعتمدة في قاعدة البيانات
    const savedOrUpdatedApprovedPlans = [];

    for (const [key, item] of mapToProcess.entries()) {
      if (!item.isNew && item.docToUpdate) {
        // تحديث الخطة المعتمدة سابقاً بعد إضافة أرقام ومعرفات الخطط الجديدة لها
        item.docToUpdate.target_seminars_count =
          item.data.target_seminars_count;
        item.docToUpdate.media_outlets_count = item.data.media_outlets_count;
        item.docToUpdate.digital_media_activities_count =
          item.data.digital_media_activities_count;
        item.docToUpdate.target_attendees = item.data.target_attendees;
        item.docToUpdate.merged_from_ids = item.data.merged_from_ids;
        item.docToUpdate.reviewed_by = reviewerId;
        item.docToUpdate.reviewed_at = new Date();

        const updated = await item.docToUpdate.save();
        savedOrUpdatedApprovedPlans.push(updated);
      } else if (item.isNew) {
        // إنشاء سجل خطة معتمدة جديدة كلياً
        const newApprovedPlan = new PlacePlan({
          ...item.data,
          status: PlanStatus.APPROVED,
          reviewed_by: reviewerId,
          reviewed_at: new Date(),
        });

        const saved = await newApprovedPlan.save();
        savedOrUpdatedApprovedPlans.push(saved);
      }
    }

    // 4. حذف أو إزالة المسودات المعلقة الأصليّة بعد أن تمت معالجتها ودمج معرفاتها داخل `merged_from_ids`
    const pendingIds = pendingPlans.map((p) => p._id);
    await PlacePlan.deleteMany({ _id: { $in: pendingIds } });

    return res.status(200).json({
      success: true,
      message: userIdToApprove
        ? "تم اعتماد خطط الموظف ودمجها بنجاح."
        : "تم اعتماد جميع خطط المكان ودمج المكرر بنجاح.",
      approvedCount: savedOrUpdatedApprovedPlans.length,
      mergedSourceCount: pendingPlans.length,
      data: savedOrUpdatedApprovedPlans,
    });
  } catch (error: any) {
    console.error("Error in approve_place_plans:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 3. دمج خطط متعددة في خطة واحدة معتمدة

// export const merge_plan_to_one = async (
//   req: AuthenticatedPlaceRequest,
//   res: Response,
// ) => {
//   try {
//     const { placeId } = req.params;
//     const { selectedPlanIds, mergedData } = req.body;
//     const userId = req.user?._id || req.user?.id;

//     if (
//       !selectedPlanIds ||
//       !Array.isArray(selectedPlanIds) ||
//       selectedPlanIds.length < 2
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: "يجب اختيار خططتين على الأقل لإتمام عملية الدمج.",
//       });
//     }

//     // إنشاء الخطة المدموجة الجديدة بحالة معتمدة
//     const newMergedPlan = new PlacePlan({
//       ...mergedData,
//       place_id: placeId,
//       created_by: userId,
//       status: PlanStatus.APPROVED,
//       reviewed_by: userId,
//       reviewed_at: new Date(),
//       merged_from_ids: selectedPlanIds,
//     });

//     await newMergedPlan.save();

//     // تحديث حالة الخطط الأصلية لتصبح مكتملة/مدموجة كي لا تظهر في قائمة المراجعة
//     await PlacePlan.updateMany(
//       { _id: { $in: selectedPlanIds } },
//       {
//         $set: {
//           status: PlanStatus.COMPLETED,
//           reviewed_by: userId,
//           reviewed_at: new Date(),
//         },
//       },
//     );

//     return res.status(201).json({
//       success: true,
//       message: "تم دمج الخطط بنجاح وإصدار الخطة المعتمدة.",
//       data: newMergedPlan,
//     });
//   } catch (error: any) {
//     return res.status(500).json({ success: false, message: error.message });
//   }
// };

//
export const getPlacesAndSchedules = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
) => {
  try {
    const placeId = req.params.placeId;

    if (!placeId) {
      return res
        .status(400)
        .json({ success: false, message: "معرف المكان (placeId) مطلوب." });
    }
    // 1. جلب جميع الأماكن
    const places = await Place.find({
      ancestors: new Types.ObjectId(placeId as string),
    })
      .select("name _id")
      .lean();
    const parentPlace = await Place.findById(placeId).select("name _id").lean();
    if (parentPlace) {
      places.unshift(parentPlace);
    }

    // 2. جلب جداول الموضوعات
    const tables = await TopicsTables.find().lean();

    res.status(200).json({ success: true, places, tables });
  } catch (error: any) {
    console.error("Error in getPlacesAndSchedules:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const filterEventsAndPlans = async (
  req: AuthenticatedPlaceRequest,
  res: Response,
) => {
  try {
    const { selectedPlaces, selectedEventTypes, dateRange, topicsFilter } =
      req.body;

    // --- 0. التحقق من صحة البيانات (Validation) ---

    // التأكد من وجود الـ Body ككائن
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({
        success: false,
        message: "بيانات الطلب غير صالحة (Body is missing or invalid)",
      });
    }

    // التحقق من صحة مصفوفات الأماكن والأنواع إذا أُرسلت
    if (selectedPlaces && !Array.isArray(selectedPlaces)) {
      return res.status(400).json({
        success: false,
        message: "حقل selectedPlaces يجب أن يكون مصفوفة (Array)",
      });
    }

    if (selectedEventTypes && !Array.isArray(selectedEventTypes)) {
      return res.status(400).json({
        success: false,
        message: "حقل selectedEventTypes يجب أن يكون مصفوفة (Array)",
      });
    }

    // التحقق من صحة التواريخ وإمكانية تحويلها لـ Dates صالحة
    if (dateRange) {
      if (typeof dateRange !== "object") {
        return res.status(400).json({
          success: false,
          message: "حقل dateRange يجب أن يكون كائن (Object)",
        });
      }

      if (dateRange.start && isNaN(Date.parse(dateRange.start))) {
        return res.status(400).json({
          success: false,
          message: "تاريخ البداية (dateRange.start) غير صالح",
        });
      }

      if (dateRange.end && isNaN(Date.parse(dateRange.end))) {
        return res.status(400).json({
          success: false,
          message: "تاريخ النهاية (dateRange.end) غير صالح",
        });
      }
    }

    // التحقق من صحة كائن الفلترة بالمواد/الموضوعات
    if (topicsFilter) {
      if (typeof topicsFilter !== "object") {
        return res.status(400).json({
          success: false,
          message: "حقل topicsFilter يجب أن يكون كائن (Object)",
        });
      }

      if (
        topicsFilter.customTopics &&
        !Array.isArray(topicsFilter.customTopics)
      ) {
        return res.status(400).json({
          success: false,
          message: "حقل customTopics يجب أن يكون مصفوفة (Array)",
        });
      }
    }

    const startDate = new Date(dateRange.start);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(dateRange.end);
    endDate.setHours(23, 59, 59, 999);

    // --- بناء استعلام MongoDB ---

    let query: Record<string, any> = {};

    // 1. فلترة نطاق الأماكن
    if (
      selectedPlaces &&
      !selectedPlaces.includes("ALL") &&
      selectedPlaces.length > 0
    ) {
      query.place_id = { $in: selectedPlaces };
    }

    // 2. فلترة أنواع الندوات
    if (
      selectedEventTypes &&
      !selectedEventTypes.includes("ALL") &&
      selectedEventTypes.length > 0
    ) {
      query.location_type = { $in: selectedEventTypes };
    }

    // 3. فلترة الفترة الزمنية
    if (dateRange?.start || dateRange?.end) {
      query.planned_date = {};
      if (dateRange.start) query.planned_date.$gte = startDate;
      if (dateRange.end) query.planned_date.$lte = endDate;
    }

    // 4. فلترة الموضوعات (Custom Topics)
    if (
      topicsFilter &&
      !topicsFilter.isAllTopics &&
      topicsFilter.customTopics?.length > 0
    ) {
      const topicConditions = topicsFilter.customTopics.map(
        (topic: { schedule_name: any; mainTopic: any; subTopic: any }) => {
          const condition: Record<string, any> = {
            schedule_name: topic.schedule_name,
          };
          if (topic.mainTopic) condition.main_topic = topic.mainTopic;
          if (topic.subTopic) condition.sub_topic = topic.subTopic;
          return condition;
        },
      );

      query.$or = topicConditions;
    }

    const plans = await PlacePlan.find(query).populate([
      {
        path: "place_id",
        select: "name metadata.photo_url",
      },
      {
        path: "created_by",
        select: "first_name last_name email avatar_url",
      },
    ]);

    let events: IPlaceEvent[] = [];
    if (ROLE_WEIGHTS[req.placeAccess?.role as PlaceRole] >= 2) {
      delete query.planned_date; // إزالة شرط التاريخ من الاستعلام للحصول على الأحداث بشكل منفصل

      query.event_date = { $gte: startDate, $lte: endDate };

      events = await PlaceEvent.find(query).populate([
        {
          path: "place_id",
          select: "name metadata.photo_url",
        },
        {
          path: "instructor_info",
          select: "first_name last_name email avatar_url",
        },
      ]);
    }

    return res.status(200).json({
      success: true,
      count: events.length,
      events,
      plans,
    });
  } catch (error: any) {
    console.log("Error in filterEventsAndPlans:", error.message);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب البيانات",
      error: error.message,
    });
  }
};

export const updateApprovedPlan = async (req: Request, res: Response) => {
  try {
    const { placeId, planId } = req.params;
    const { action, count, ...updateData } = req.body;
    const adminUserId = req.user?._id; // ID الشخص المسؤول عن الاعتماد/التعديل

    // توحيد الحقل القادم من الفرونت (سواء كان count أو target_seminars_count)
    const seminarsCount = count ?? updateData.target_seminars_count;

    const isNew = planId === "new" || action === "CREATE";

    // دالة مساعدة لتوحيد شكل البيانات المرجعة للفرونت إند
    const formatResponseData = (doc: any) => {
      const plainObj = doc.toObject ? doc.toObject() : doc;
      return {
        ...plainObj,
        id: plainObj._id.toString(),
        count: plainObj.target_seminars_count ?? 1,
      };
    };

    // ==========================================
    // 1. سيناريو إضافة صف جديد معتمد بواسطة المسؤول
    // ==========================================
    if (isNew) {
      if (!placeId) {
        return res.status(400).json({
          success: false,
          message: "معرف المكان (placeId) مطلوب لإضافة صف جديد",
        });
      }

      // تحديد صاحب الخطة الأصلي (أو المسؤول إن لم يحدد)
      const targetUserId = updateData.created_by || adminUserId;

      const externalLocation =
        updateData.location_type === "external_seminar" ||
        updateData.location_type === "public_meeting" ||
        updateData.location_type === "convoy_seminars"
          ? updateData.external_location_name
          : null;

      // البحث عن صف مطابق **معتمد (APPROVED)** لنفس الموظف
      const existingMatchingPlan = await PlacePlan.findOne({
        _id: { $ne: new Types.ObjectId(planId as string) },
        place_id: placeId,
        created_by: new Types.ObjectId(targetUserId),
        schedule_name: updateData.schedule_name,
        main_topic: updateData.main_topic,
        sub_topic: updateData.sub_topic,
        location_type: updateData.location_type,
        external_location_name: externalLocation,
        planned_date: updateData.planned_date,
        status: PlanStatus.APPROVED,
      });

      if (existingMatchingPlan) {
        existingMatchingPlan.target_seminars_count += seminarsCount || 1;

        existingMatchingPlan.media_outlets_count =
          (existingMatchingPlan.media_outlets_count || 0) +
          (updateData.media_outlets_count || 0);

        existingMatchingPlan.digital_media_activities_count =
          (existingMatchingPlan.digital_media_activities_count || 0) +
          (updateData.digital_media_activities_count || 0);

        if (updateData.target_attendees) {
          existingMatchingPlan.target_attendees = {
            males:
              (existingMatchingPlan.target_attendees?.males || 0) +
              (updateData.target_attendees.males || 0),
            females:
              (existingMatchingPlan.target_attendees?.females || 0) +
              (updateData.target_attendees.females || 0),
            children:
              (existingMatchingPlan.target_attendees?.children || 0) +
              (updateData.target_attendees.children || 0),
          };
        }

        existingMatchingPlan.target_total_attendees =
          (existingMatchingPlan.target_attendees.males || 0) +
          (existingMatchingPlan.target_attendees.females || 0) +
          (existingMatchingPlan.target_attendees.children || 0);

        // تحديث الشخص الذي قام بالمراجعة/التعديل
        existingMatchingPlan.reviewed_by = new Types.ObjectId(adminUserId);

        await existingMatchingPlan.save();
        await existingMatchingPlan.populate([
          {
            path: "place_id",
            select: "name metadata.photo_url",
          },
        ]);
        return res.status(200).json({
          success: true,
          message: "تم دمج الفعالية الجديدة مع صف معتمد موجود بالفعل",
          action: "MERGED",
          data: formatResponseData(existingMatchingPlan),
        });
      }

      const totalAttendees =
        (updateData.target_attendees?.males || 0) +
        (updateData.target_attendees?.females || 0) +
        (updateData.target_attendees?.children || 0);

      const newPlan = new PlacePlan({
        created_by: new Types.ObjectId(targetUserId),
        reviewed_by: new Types.ObjectId(adminUserId), // تعيين ID مسؤول المراجعة
        place_id: placeId,
        schedule_name: updateData.schedule_name,
        main_topic: updateData.main_topic,
        sub_topic: updateData.sub_topic,
        target_seminars_count: seminarsCount || 1,
        planned_date: updateData.planned_date,
        location_type: updateData.location_type,
        external_location_name: externalLocation,
        media_outlets_count: updateData.media_outlets_count || 0,
        digital_media_activities_count:
          updateData.digital_media_activities_count || 0,
        target_attendees: updateData.target_attendees || {
          males: 0,
          females: 0,
          children: 0,
        },
        target_total_attendees: totalAttendees,
        status: PlanStatus.APPROVED, // إنشاؤها مباشرة بحالة معتمدة
      });

      await newPlan.save();

      return res.status(201).json({
        success: true,
        message: "تمت إضافة الصف المعتمد الجديد بنجاح",
        action: "CREATED",
        data: formatResponseData(newPlan),
      });
    }

    // ==========================================
    // 2. البحث عن الصف الحالي المراد تعديله أو حذفه
    // ==========================================
    const currentPlan = await PlacePlan.findById(planId);

    if (!currentPlan) {
      return res.status(404).json({
        success: false,
        message: "لم يتم العثور على الخطة المطلوبة",
      });
    }

    // التحقق من أن الخطة في حالة APPROVED فقط
    if (currentPlan.status !== PlanStatus.APPROVED) {
      return res.status(400).json({
        success: false,
        message:
          "يمكن تعديل أو حذف الخطات المعتمدة (APPROVED) فقط عبر هذه الدالة",
      });
    }

    // ==========================================
    // 3. سيناريو الحذف بواسطة المسؤول
    // ==========================================
    if (action === "DELETE" || seminarsCount === 0) {
      await PlacePlan.findByIdAndDelete(planId);
      return res.status(200).json({
        success: true,
        message: "تم حذف صف الخطة المعتمدة بنجاح",
        action: "DELETED",
      });
    }

    // ==========================================
    // 4. سيناريو التعديل والدمج بواسطة المسؤول
    // ==========================================
    const targetScheduleName =
      updateData.schedule_name ?? currentPlan.schedule_name;
    const targetMainTopic = updateData.main_topic ?? currentPlan.main_topic;
    const targetSubTopic = updateData.sub_topic ?? currentPlan.sub_topic;
    const targetLocationType =
      updateData.location_type ?? currentPlan.location_type;

    const targetExternalLocation =
      targetLocationType === "external_seminar" ||
      targetLocationType === "public_meeting" ||
      targetLocationType === "convoy_seminars"
        ? (updateData.external_location_name ??
          currentPlan.external_location_name)
        : null;

    const targetPlannedDate =
      updateData.planned_date ?? currentPlan.planned_date;

    // البحث عن خطة معتمدة مطابقة لنفس الموظف صاحب الخطة
    const existingMatchingPlan = await PlacePlan.findOne({
      _id: { $ne: new Types.ObjectId(planId as string) },
      place_id: currentPlan.place_id,
      created_by: currentPlan.created_by,
      schedule_name: targetScheduleName,
      main_topic: targetMainTopic,
      sub_topic: targetSubTopic,
      location_type: targetLocationType,
      external_location_name: targetExternalLocation,
      planned_date: targetPlannedDate,
      status: PlanStatus.APPROVED,
    });

    if (existingMatchingPlan) {
      const addedSeminarsCount =
        seminarsCount ?? currentPlan.target_seminars_count;
      const addedAttendees =
        updateData.target_attendees || currentPlan.target_attendees;

      const addedMediaOutlets =
        updateData.media_outlets_count ?? currentPlan.media_outlets_count ?? 0;
      const addedDigitalMedia =
        updateData.digital_media_activities_count ??
        currentPlan.digital_media_activities_count ??
        0;

      existingMatchingPlan.target_seminars_count += addedSeminarsCount;
      existingMatchingPlan.media_outlets_count =
        (existingMatchingPlan.media_outlets_count || 0) + addedMediaOutlets;
      existingMatchingPlan.digital_media_activities_count =
        (existingMatchingPlan.digital_media_activities_count || 0) +
        addedDigitalMedia;

      if (addedAttendees) {
        existingMatchingPlan.target_attendees = {
          males:
            (existingMatchingPlan.target_attendees?.males || 0) +
            (addedAttendees.males || 0),
          females:
            (existingMatchingPlan.target_attendees?.females || 0) +
            (addedAttendees.females || 0),
          children:
            (existingMatchingPlan.target_attendees?.children || 0) +
            (addedAttendees.children || 0),
        };
      }

      existingMatchingPlan.target_total_attendees =
        (existingMatchingPlan.target_attendees.males || 0) +
        (existingMatchingPlan.target_attendees.females || 0) +
        (existingMatchingPlan.target_attendees.children || 0);

      // تحديث الشخص المراجع
      existingMatchingPlan.reviewed_by = new Types.ObjectId(adminUserId);

      await existingMatchingPlan.save();
      await PlacePlan.findByIdAndDelete(planId);
      await existingMatchingPlan.populate([
        {
          path: "place_id",
          select: "name metadata.photo_url",
        },
      ]);

      return res.status(200).json({
        success: true,
        message: "تم دمج بيانات الصف مع صف آخر معتمد بنجاح",
        action: "MERGED",
        data: formatResponseData(existingMatchingPlan),
      });
    }

    // ==========================================
    // 5. سيناريو التحديث العادي بواسطة المسؤول
    // ==========================================
    if (updateData.schedule_name !== undefined)
      currentPlan.schedule_name = updateData.schedule_name;
    if (updateData.main_topic !== undefined)
      currentPlan.main_topic = updateData.main_topic;
    if (updateData.sub_topic !== undefined)
      currentPlan.sub_topic = updateData.sub_topic;
    if (seminarsCount !== undefined)
      currentPlan.target_seminars_count = seminarsCount;
    if (updateData.planned_date !== undefined)
      currentPlan.planned_date = updateData.planned_date;
    if (updateData.location_type !== undefined)
      currentPlan.location_type = updateData.location_type;

    currentPlan.external_location_name =
      currentPlan.location_type === "external_seminar" ||
      currentPlan.location_type === "public_meeting" ||
      currentPlan.location_type === "convoy_seminars"
        ? (updateData.external_location_name ??
          currentPlan.external_location_name)
        : null;

    if (updateData.media_outlets_count !== undefined)
      currentPlan.media_outlets_count = updateData.media_outlets_count;
    if (updateData.digital_media_activities_count !== undefined)
      currentPlan.digital_media_activities_count =
        updateData.digital_media_activities_count;

    if (updateData.target_attendees !== undefined) {
      currentPlan.target_attendees = updateData.target_attendees;
      currentPlan.target_total_attendees =
        (updateData.target_attendees.males || 0) +
        (updateData.target_attendees.females || 0) +
        (updateData.target_attendees.children || 0);
    }

    // تسجيل معرف الشخص الذي أجرى التعديل في حقل reviewed_by
    currentPlan.reviewed_by = new Types.ObjectId(adminUserId);

    await currentPlan.save();
    await currentPlan.populate([
      {
        path: "place_id",
        select: "name metadata.photo_url",
      },
    ]);

    return res.status(200).json({
      success: true,
      message: "تم حفظ تعديلات الخطة المعتمدة بنجاح",
      action: "UPDATED",
      data: formatResponseData(currentPlan),
    });
  } catch (error: any) {
    console.log("Error in updateApprovedPlan:", error.message);
    return res.status(400).json({
      success: false,
      message: error.message || "حدث خطأ أثناء تحديث الخطة المعتمدة",
    });
  }
};

export const updateEvent = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { count, ...updateData } = req.body;

    // توحيد الحقل القادم من الفرونت (سواء كان count أو seminars_count)
    const seminarsCount = count ?? updateData.seminars_count;

    // دالة مساعدة لتوحيد شكل البيانات المرجعة للفرونت إند
    const formatResponseData = (doc: any) => {
      const plainObj = doc.toObject ? doc.toObject() : doc;
      return {
        ...plainObj,
        id: plainObj._id.toString(),
        count: plainObj.seminars_count ?? 1,
      };
    };

    // 1. البحث عن الندوة الحالية المراد تعديلها
    const currentEvent = await PlaceEvent.findById(eventId);

    if (!currentEvent) {
      return res.status(404).json({
        success: false,
        message: "لم يتم العثور على الندوة المطلوبة",
      });
    }

    // console.log(updateData.external_location_name);
    // 2. تجهيز البيانات المستهدفة للتعديل
    const targetScheduleName =
      updateData.schedule_name ?? currentEvent.schedule_name;
    const targetMainTopic = updateData.main_topic ?? currentEvent.main_topic;
    const targetSubTopic = updateData.sub_topic ?? currentEvent.sub_topic;
    const targetLocationType =
      updateData.location_type ?? currentEvent.location_type;

    const targetExternalLocation =
      targetLocationType === EventLocationType.EXTERNAL_SEMINAR ||
      targetLocationType === EventLocationType.PUBLIC_MEETING ||
      targetLocationType === EventLocationType.CONVOY_SEMINARS
        ? (updateData.external_location_name ??
          currentEvent.external_location_name)
        : null;

    // تجهيز التاريخ وتصفير الوقت تماماً (بداية ونهاية اليوم للمقارنة)
    const rawTargetDate =
      updateData.event_date ?? updateData.date ?? currentEvent.event_date;

    const startOfDay = new Date(rawTargetDate);
    startOfDay.setUTCHours(0, 0, 0, 0); // بداية اليوم

    const endOfDay = new Date(rawTargetDate);
    endOfDay.setUTCHours(23, 59, 59, 999); // نهاية اليوم

    const targetInstructorInfo =
      updateData.instructor_info ?? currentEvent.instructor_info;

    // 3. البحث عن ندوة مطابقة أخرى (غير الحالية) لنفس الموظف والمحاضر والبيانات في نفس اليوم
    const existingMatchingEvent = await PlaceEvent.findOne({
      _id: { $ne: new Types.ObjectId(eventId as string) },
      place_id: currentEvent.place_id,
      instructor_info: new Types.ObjectId(targetInstructorInfo),
      schedule_name: targetScheduleName,
      main_topic: targetMainTopic,
      sub_topic: targetSubTopic,
      location_type: targetLocationType,
      external_location_name: targetExternalLocation,
      event_date: { $gte: startOfDay, $lte: endOfDay }, // نطاق اليوم بالكامل بدلاً من مقارنة الوقت
    });

    // سيناريو الدمج في حال وجود سجل مطابق في نفس اليوم
    if (existingMatchingEvent) {
      const addedSeminarsCount = seminarsCount ?? currentEvent.seminars_count;
      const addedAttendees = updateData.attendees || currentEvent.attendees;

      const addedMediaOutlets =
        updateData.media_outlets_count ??
        (currentEvent as any).media_outlets_count ??
        0;
      const addedDigitalMedia =
        updateData.digital_media_activities_count ??
        (currentEvent as any).digital_media_activities_count ??
        0;

      existingMatchingEvent.seminars_count += addedSeminarsCount;

      if (addedMediaOutlets !== undefined) {
        (existingMatchingEvent as any).media_outlets_count =
          ((existingMatchingEvent as any).media_outlets_count || 0) +
          addedMediaOutlets;
      }

      if (addedDigitalMedia !== undefined) {
        (existingMatchingEvent as any).digital_media_activities_count =
          ((existingMatchingEvent as any).digital_media_activities_count || 0) +
          addedDigitalMedia;
      }

      if (addedAttendees) {
        existingMatchingEvent.attendees = {
          males:
            (existingMatchingEvent.attendees?.males || 0) +
            (addedAttendees.males || 0),
          females:
            (existingMatchingEvent.attendees?.females || 0) +
            (addedAttendees.females || 0),
          children:
            (existingMatchingEvent.attendees?.children || 0) +
            (addedAttendees.children || 0),
        };
      }

      existingMatchingEvent.total_attendees =
        (existingMatchingEvent.attendees.males || 0) +
        (existingMatchingEvent.attendees.females || 0) +
        (existingMatchingEvent.attendees.children || 0);

      await existingMatchingEvent.save();
      await PlaceEvent.findByIdAndDelete(eventId); // حذف السجل القديم بعد دمج بياناته
      await existingMatchingEvent.populate([
        { path: "place_id", select: "name metadata.photo_url" },
        {
          path: "instructor_info",
          select: "first_name last_name avatar_url email",
        },
      ]);

      return res.status(200).json({
        success: true,
        message: "تم دمج بيانات الندوة مع ندوة أخرى مطابقة بنجاح",
        action: "MERGED",
        data: formatResponseData(existingMatchingEvent),
      });
    }

    // 4. سيناريو التحديث العادي (حالة عدم وجود سجل آخر مطابق)
    if (updateData.schedule_name !== undefined)
      currentEvent.schedule_name = updateData.schedule_name;
    if (updateData.main_topic !== undefined)
      currentEvent.main_topic = updateData.main_topic;
    if (updateData.sub_topic !== undefined)
      currentEvent.sub_topic = updateData.sub_topic;
    if (seminarsCount !== undefined)
      currentEvent.seminars_count = seminarsCount;

    // حفظ التاريخ مصفّر الوقت (ساعات 00:00:00)
    if (updateData.event_date !== undefined || updateData.date !== undefined) {
      const cleanDate = new Date(updateData.event_date || updateData.date);
      cleanDate.setUTCHours(0, 0, 0, 0);
      currentEvent.event_date = cleanDate;
    }

    if (updateData.location_type !== undefined)
      currentEvent.location_type = updateData.location_type;
    if (updateData.instructor_info !== undefined)
      currentEvent.instructor_info = new Types.ObjectId(
        updateData.instructor_info,
      );

    currentEvent.external_location_name =
      currentEvent.location_type === EventLocationType.EXTERNAL_SEMINAR ||
      currentEvent.location_type === EventLocationType.PUBLIC_MEETING ||
      currentEvent.location_type === EventLocationType.CONVOY_SEMINARS
        ? (updateData.external_location_name ??
          currentEvent.external_location_name)
        : null;

    if (updateData.media_outlets_count !== undefined)
      (currentEvent as any).media_outlets_count =
        updateData.media_outlets_count;
    if (updateData.digital_media_activities_count !== undefined)
      (currentEvent as any).digital_media_activities_count =
        updateData.digital_media_activities_count;

    if (updateData.attendees !== undefined) {
      currentEvent.attendees = updateData.attendees;
      currentEvent.total_attendees =
        (updateData.attendees.males || 0) +
        (updateData.attendees.females || 0) +
        (updateData.attendees.children || 0);
    }

    await currentEvent.save();
    await currentEvent.populate([
      { path: "place_id", select: "name metadata.photo_url" },
      {
        path: "instructor_info",
        select: "first_name last_name avatar_url email",
      },
    ]);

    return res.status(200).json({
      success: true,
      message: "تم حفظ تعديلات الندوة بنجاح",
      action: "UPDATED",
      data: formatResponseData(currentEvent),
    });
  } catch (error: any) {
    console.log("Error in updateApprovedEvent:", error.message);
    return res.status(400).json({
      success: false,
      message: error.message || "حدث خطأ أثناء تحديث بيانات الندوة",
    });
  }
};

export const deleteEvent = async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;

    // 1. البحث عن الندوة وحذفها
    const deletedEvent = await PlaceEvent.findByIdAndDelete(eventId);

    // 2. التحقق من وجود الندوة قبل الحذف
    if (!deletedEvent) {
      return res.status(404).json({
        success: false,
        message: "لم يتم العثور على الندوة المطلوبة للحذف",
      });
    }

    // 3. إرجاع استجابة بالنجاح مع بيانات الندوة المحذوفة
    return res.status(200).json({
      success: true,
      message: "تم حذف الندوة بنجاح",
      data: {
        id: deletedEvent._id.toString(),
      },
    });
  } catch (error: any) {
    console.log("Error in deleteEvent:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "حدث خطأ أثناء حذف الندوة",
    });
  }
};
