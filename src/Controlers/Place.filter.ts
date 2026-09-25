import type { Response } from "express";
import type { AuthenticatedPlaceRequest } from "../middleware/validateCreatePlace";
import { Place } from "../Models/Place";
import { Types } from "mongoose";
import TopicsTables from "../Models/TopicsTables";
import { PlacePlan } from "../Models/PlacePlan";
import { PlaceEvent, type IPlaceEvent } from "../Models/PlaceEvent";
import { ROLE_WEIGHTS } from "./Places";
import type { PlaceRole } from "../types/placeAccess";

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