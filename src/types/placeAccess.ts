// types/placeAccess.ts

// 1. الأدوار الخاصة بكل مكان
export const PlaceRole = {
  ADMIN: "place_admin", // مدير المكان (صلاحية كاملة وإضافة أفرع واعتماد خطط)
  SUPERVISOR: "place_supervisor", // مشرف تشغيلي (مراجعة، دمج، واعتماد الخطط)
  OPERATOR: "place_operator", // عضو ميداني (إنشاء مسودات الخطط، تسجيل ندوات وتوثيق)
  VIEWER: "place_viewer", // مشاهد فقط
} as const;

export type PlaceRole = (typeof PlaceRole)[keyof typeof PlaceRole];

// 2. قائمة الصلاحيات الدقيقة (Fine-grained Permissions)
export const PlacePermission = {
  // إدارة المكان والتسلسل الهرمي
  CREATE_SUB_PLACE: "place:create_sub",
  EDIT_PLACE_INFO: "place:edit_info",
  DELETE_PLACE: "place:delete",

  // إدارة الأعضاء والصلاحيات
  MANAGE_MEMBERS: "place:manage_members",
  VIEW_MEMBERS: "place:view_members",

  // 📝 إدارة الخطط المستهدفة (دورة الحياة والاعتماد)
  VIEW_PLAN: "place:view_plan", // عرض الخطط

  CREATE_PLAN: "place:create_plan", // إنشاء مسودة خطة (Draft)

  SUBMIT_PLAN: "place:submit_plan", // رفع المسودة للمراجعة (Draft -> Pending Review)

  MERGE_PLANS: "place:merge_plans", // دمج خطط متعددة من عدة أعضاء في خطة واحدة معتمدة
  APPROVE_PLAN: "place:approve_plan", // اعتماد أو رفض الخطة (Pending Review -> Approved/Rejected)

  EDIT_PLAN: "place:edit_plan", // تعديل المسودات الخاصة أو المفتوحة
  DELETE_PLAN: "place:delete_plan", // حذف المسودات

  // إدارة العمليات الميدانية والندوات
  CREATE_EVENT: "place:create_event",
  EDIT_EVENT: "place:edit_event",
  DELETE_EVENT: "place:delete_event",

  // التوثيق والقراءة
  VIEW_PLACE: "place:view",
  UPLOAD_MEDIA: "place:upload_media",
} as const;

export type PlacePermission =
  (typeof PlacePermission)[keyof typeof PlacePermission];

// 3. خريطة الصلاحيات الممررة تلقائياً لكل دور (Default Role Permissions Mapping)
export const DEFAULT_ROLE_PERMISSIONS: Record<PlaceRole, PlacePermission[]> = {
  [PlaceRole.ADMIN]: [
    PlacePermission.CREATE_SUB_PLACE,
    PlacePermission.EDIT_PLACE_INFO,
    PlacePermission.DELETE_PLACE,
    PlacePermission.MANAGE_MEMBERS,
    PlacePermission.VIEW_MEMBERS,
    // صلاحيات الخطط الكاملة للآدمن
    PlacePermission.CREATE_PLAN,
    PlacePermission.EDIT_PLAN,
    PlacePermission.DELETE_PLAN,
    PlacePermission.VIEW_PLAN,
    PlacePermission.SUBMIT_PLAN,
    PlacePermission.APPROVE_PLAN,
    PlacePermission.MERGE_PLANS,
    // العمليات والتفريغات
    PlacePermission.CREATE_EVENT,
    PlacePermission.EDIT_EVENT,
    PlacePermission.DELETE_EVENT,
    PlacePermission.VIEW_PLACE,
    PlacePermission.UPLOAD_MEDIA,
  ],

  [PlaceRole.SUPERVISOR]: [
    PlacePermission.VIEW_MEMBERS,

    // صلاحيات إدارة الخطط والدمج والاعتماد للمشرف
    PlacePermission.CREATE_PLAN,
    PlacePermission.EDIT_PLAN,
    PlacePermission.DELETE_PLAN,
    PlacePermission.VIEW_PLAN,
    PlacePermission.SUBMIT_PLAN,
    PlacePermission.APPROVE_PLAN, // اعتماد أو رفض
    PlacePermission.MERGE_PLANS, // دمج خطط الفريق

    // العمليات الميدانية
    PlacePermission.CREATE_EVENT,
    PlacePermission.EDIT_EVENT,
    PlacePermission.VIEW_PLACE,
    PlacePermission.UPLOAD_MEDIA,
  ],

  [PlaceRole.OPERATOR]: [
    // إمكانية إنشاء مسودة خطة ورفعها للمشرف فقط (بدون اعتماد أو دمج)

    // PlacePermission.CREATE_PLAN,
    // PlacePermission.EDIT_PLAN,
    PlacePermission.VIEW_PLAN,
    // PlacePermission.SUBMIT_PLAN,
    // العمليات الميدانية
    PlacePermission.CREATE_EVENT,
    PlacePermission.VIEW_PLACE,
    // PlacePermission.UPLOAD_MEDIA,
  ],

  [PlaceRole.VIEWER]: [PlacePermission.VIEW_PLACE, PlacePermission.VIEW_PLAN],
};

// 4. واجهة دعم الصلاحيات مع تاريخ الانتهاء للموظفين (Temporary/Expiring Permissions)
export interface UserPlacePermissionItem {
  permission: PlacePermission;
  grantedAt: string | Date;
  expiresAt: string | Date | null; // null تعني صلاحية دائمة لا تنتهي
}

// دالة مساعدة للتحقق من سريان الصلاحية
export const isPermissionValid = (item: UserPlacePermissionItem): boolean => {
  if (!item.expiresAt) return true; // دائمة
  const expirationDate = new Date(item.expiresAt).getTime();
  const currentDate = new Date().getTime();
  return expirationDate > currentDate; // صالحة فقط إذا كان تاريخ الانتهاء أكبر من الوقت الحالي
};
