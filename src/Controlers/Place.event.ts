import type { Request, Response } from "express";
import type { AuthenticatedPlaceRequest } from "../middleware/validateCreatePlace.ts";
import { ROLE_WEIGHTS } from "./Places.ts";
import { PlacePermission, type PlaceRole } from "../types/placeAccess.ts";
import { Place, type IPlace } from "../Models/Place.ts";
import { UserPlaceAccess } from "../Models/UserPlaceAccess.ts";
import type { IUser } from "../Models/User.ts";
import TopicsTables from "../Models/TopicsTables.ts";
import { Types } from "mongoose";
import { EventLocationType, PlaceEvent } from "../Models/PlaceEvent.ts";

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
