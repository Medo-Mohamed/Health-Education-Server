import type { Request, Response, NextFunction } from "express";
import TopicsTables from "../Models/TopicsTables";
export const createTopicTable = async (req: Request, res: Response) => {
  try {
    const { description, title } = req.body;

    // console.log(description, title);

    // ملاحظة: حتى لو كانت المصفوفة فارغة عند الإنشاء كما ذكرت،
    // الـ Schema ستتعامل معها كمصفوفة فارغة افتراضياً.

    const newTable = new TopicsTables({
      description,
      title,
      table_rows: [],
    });

    await newTable.save();

    const tables = await TopicsTables.find({})
      .select("_id title description")
      .sort({ created_at: -1 }); // عرض الأحدث أولاً
    res.status(201).json({
      success: true,
      message: "تم إنشاء الجدول بنجاح",
      data: tables,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "خانة العنوان موجودة بالفعل",
      });
    }

    // معالجة الأخطاء القادمة من الـ Pre-save hook أو الـ Validations
    res.status(400).json({
      success: false,
      message: error.message || "حدث خطأ أثناء إنشاء الجدول",
    });
  }
};

export const getAllTablesSummary = async (req: Request, res: Response) => {
  try {
    // استخدام .select() لتحديد الحقول المطلوبة فقط
    // ملاحظة: إذا أضفت حقل description لاحقاً يمكنك إضافته هنا
    const tables = await TopicsTables.find({})
      .select("_id title description")
      .sort({ created_at: -1 }); // عرض الأحدث أولاً

    res.status(200).json({
      success: true,
      data: tables,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.messag || "حدث خطأ أثناء جلب البيانات",
    });
  }
};

export const getTablesSummary = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const table = await TopicsTables.findById(id);

    if (!table)
      return res.status(404).json({
        success: false,
        message: "هذا الجدول غير موجود",
      });

    res.status(200).json({
      success: true,
      data: table,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.messag || "حدث خطأ أثناء جلب البيانات",
    });
  }
};

export const updateTitleAndDec = async (req: Request, res: Response) => {
  try {
    console.log();
    const { id, newTitle, newDescription } = req.body;
    // console.log({ id, newTitle, newDescription });
    const table = await TopicsTables.findById(id);

    if (!id || !newTitle) {
      return res.status(401).json({
        success: false,
        message: "يرجى تقديم معرف الجدول والعنوان الجديد على الأقل",
      });
    }
    if (!table)
      return res.status(404).json({
        success: false,
        message: "هذا الجدول غير موجود",
      });

    table.title = newTitle;
    table.description = newDescription;

    await table.save();
    res.status(200).json({
      success: true,
      message: "تم تحديث بيانات الجدول بنجاح",
      data: table,
    });
  } catch (error: any) {
    console.error("Error in updateTitleAndDec:", error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message:
          "عذراً، هذا العنوان مستخدم بالفعل في جدول آخر، يرجى اختيار عنوان فريد",
      });
    }
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "معرف الجدول المرسل غير صالح",
      });
    }
    res.status(500).json({
      success: false,
      message: error.messag || "حدث خطأ أثناء جلب البيانات",
    });
  }
};

export const updateTableRows = async (req: Request, res: Response) => {
  try {
    const { id, table_rows } = req.body;

    // 1. التحقق من وجود البيانات المطلوبة
    if (!id || !Array.isArray(table_rows)) {
      return res.status(400).json({
        success: false,
        message: "يرجى تقديم معرف الجدول ومصفوفة الصفوف الجديدة بشكل صحيح",
      });
    }

    // 2. البحث عن الجدول
    const table = await TopicsTables.findById(id);

    if (!table) {
      return res.status(404).json({
        success: false,
        message: "عذراً، هذا الجدول غير موجود",
      });
    }

    // 3. استبدال المصفوفة القديمة بالجديدة
    // ملاحظة: الـ pre-save hook الذي أنشأته سيعمل تلقائياً عند استدعاء .save()
    // وسيتأكد من عدم تكرار الـ supTopic في المصفوفة الجديدة
    table.table_rows = table_rows;

    await table.save();

    res.status(200).json({
      success: true,
      message: "تم تحديث محتويات الجدول وترتيب الصفوف بنجاح",
      data: table,
    });
  } catch (error: any) {
    console.error("Error in updateTableRows:", error);

    // معالجة الخطأ الذي رميته أنت في الـ pre-save hook (تكرار الموضوع الفرعي)
    if (error.message === "لا يمكن تكرار الموضوع الفرعي داخل نفس الجدول") {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    // معالجة أخطاء التنسيق (CastError)
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "معرف الجدول غير صالح",
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || "حدث خطأ داخلي أثناء تحديث الصفوف",
    });
  }
};


export const deleteTopic = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // استلام الـ ID من الرابط
    const deletedItem = await TopicsTables.findByIdAndDelete(id);

    if (!deletedItem) {
      return res.status(404).json({ message: "هذا السجل غير موجود" });
    }

    res.status(200).json({ message: "تم الحذف بنجاح" });
  } catch (error: any) {
    res.status(500).json({ message: "خطأ في السيرفر", error });
  }
};
