import type { Request, Response } from "express";
import type { AuthenticatedPlaceRequest } from "../middleware/validateCreatePlace.ts";
import TopicsTables from "../Models/TopicsTables.ts";
import { Types } from "mongoose";
import { PlacePlan, PlanStatus } from "../Models/PlacePlan.ts";

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
