// types/placeAccess.ts

// 1. الأدوار الخاصة بكل مكان
export const PlaceRole = {
  ADMIN: "place_admin", // مدير المكان (صلاحية كاملة وإضافة أفرع)
  SUPERVISOR: "place_supervisor", // مشرف تشغيلي (إدارة الأنشطة والبيانات)
  OPERATOR: "place_operator", // عضو ميداني (تسجيل ندوات وتوثيق)
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

// خريطة الصلاحيات الممررة تلقائياً لكل دور (Default Role Permissions Mapping)
export const DEFAULT_ROLE_PERMISSIONS: Record<PlaceRole, PlacePermission[]> = {
  [PlaceRole.ADMIN]: [
    PlacePermission.CREATE_SUB_PLACE,
    PlacePermission.EDIT_PLACE_INFO,
    PlacePermission.DELETE_PLACE,
    PlacePermission.MANAGE_MEMBERS,
    PlacePermission.VIEW_MEMBERS,
    PlacePermission.CREATE_EVENT,
    PlacePermission.EDIT_EVENT,
    PlacePermission.DELETE_EVENT,
    PlacePermission.VIEW_PLACE,
    PlacePermission.UPLOAD_MEDIA,
  ],
  [PlaceRole.SUPERVISOR]: [
    PlacePermission.EDIT_PLACE_INFO,
    PlacePermission.VIEW_MEMBERS,
    PlacePermission.CREATE_EVENT,
    PlacePermission.EDIT_EVENT,
    PlacePermission.VIEW_PLACE,
    PlacePermission.UPLOAD_MEDIA,
  ],
  [PlaceRole.OPERATOR]: [
    PlacePermission.CREATE_EVENT,
    PlacePermission.VIEW_PLACE,
    PlacePermission.UPLOAD_MEDIA,
  ],
  [PlaceRole.VIEWER]: [PlacePermission.VIEW_PLACE],
};
