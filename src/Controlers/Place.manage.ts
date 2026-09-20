import type { Request, Response } from "express";
import type { AuthenticatedPlaceRequest } from "../middleware/validateCreatePlace.ts";
import { Place } from "../Models/Place.ts";
import cloudinary from "../Config/cloudinary.ts";
import { UserPlaceAccess } from "../Models/UserPlaceAccess.ts";
import { PlacePermission, PlaceRole } from "../types/placeAccess.ts";
import { Types } from "mongoose";

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
