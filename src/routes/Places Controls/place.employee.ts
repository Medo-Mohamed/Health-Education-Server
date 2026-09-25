import { Router } from "express";
import { authorizePermission } from "../../middleware/validateCreatePlace";
import { PlacePermission } from "../../types/placeAccess";
import {
  addStaffToPlace,
  getEligibleUsersForPlace,
  getPlaceStaff,
  getStaffPermissions,
  removeStaffFromPlace,
  updateStaffAccess,
} from "../../Controlers/Place.employee";

const placeEmployeeRouters = Router();

// جلب المستخدمين المؤهلين لإضافة موظفين جدد للمكان
placeEmployeeRouters.get(
  "/eligible-users/:placeId/",
  authorizePermission(PlacePermission.MANAGE_MEMBERS),
  getEligibleUsersForPlace,
);
// جلب قائمة الموظفين في المكان
placeEmployeeRouters.get(
  "/place-staff/:placeId/staff",
  authorizePermission(PlacePermission.VIEW_MEMBERS),
  getPlaceStaff,
);

// إضافة موظف جديد للمكان
placeEmployeeRouters.post(
  "/place-staff/:placeId/staff",
  authorizePermission(PlacePermission.MANAGE_MEMBERS),
  addStaffToPlace,
);

// 🟢 جلب البيانات المخصصة لشاشة التعديل
placeEmployeeRouters.get(
  "/place-staff-permissions/:userId/:placeId/permissions",
  authorizePermission(PlacePermission.MANAGE_MEMBERS),
  getStaffPermissions,
);

// تعديل صلاحيات موظف في المكان
placeEmployeeRouters.put(
  "/place-staff-access/:userId/:placeId/permissions",
  authorizePermission(PlacePermission.MANAGE_MEMBERS),
  updateStaffAccess,
);

// حذف موظف من المكان
placeEmployeeRouters.delete(
  "/place-staff-access/:accessId/:placeId",
  authorizePermission(PlacePermission.MANAGE_MEMBERS),
  removeStaffFromPlace,
);

export default placeEmployeeRouters;
