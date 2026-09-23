import type { Request, Response } from "express";
import { Place } from "../Models/Place.ts";
import mongoose from "mongoose";
import {
  UserPlaceAccess,
  type ICustomPermission,
} from "../Models/UserPlaceAccess.ts";
import { Types } from "mongoose";
import User from "../Models/User.ts";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PlacePermission,
  PlaceRole,
} from "../types/placeAccess.ts";
import type { AuthenticatedPlaceRequest } from "../middleware/validateCreatePlace.ts";
import { ROLE_WEIGHTS } from "./Places.ts";

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

    // 🟢 الشرط 1 (أ): إذا كان المستخدم Dev أو Super Admin -> حذف فوراً
    const isDevOrSuperAdmin = currentUser.role === "dev";

    if (isDevOrSuperAdmin) {
      await UserPlaceAccess.findByIdAndDelete(accessId);
      return res
        .status(200)
        .json({ message: "تمت إزالة الموظف بنجاح بواسطة مسؤول النظام." });
    }
    
    // 🔴 الشرط 2: لا يمكن للشخص حذف نفسه
    if (targetUserId === currentUserId) {
      return res.status(400).json({
        message: "لا يمكنك إزالة صلاحيتك الخاصة بنفسك من هذا المكان.",
      });
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
