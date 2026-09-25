import { Router } from "express";
import { authorizePermission } from "../../middleware/validateCreatePlace";
import { PlacePermission } from "../../types/placeAccess";
import {
  adminUpdatePendingPlan,
  checkPlacePlanAccess,
  get_pending_reviews,
  getDraftsPlans,
  approve_place_plans,
  saveDraftPlans,
  submitToPreReview,
  updateDraftPlan,
  updateApprovedPlan,
} from "../../Controlers/Place.plans";

const placePlansRouter = Router();

placePlansRouter.get(
  "/check-can-create/:placeId",
  authorizePermission(PlacePermission.CREATE_PLAN),
  checkPlacePlanAccess,
);
/* */
placePlansRouter.post(
  "/save-plan-draft/:placeId",
  authorizePermission(PlacePermission.CREATE_EVENT),
  saveDraftPlans,
);

//

placePlansRouter.get(
  "/get-plan-draft/:placeId",
  authorizePermission(PlacePermission.CREATE_EVENT),
  getDraftsPlans,
);

placePlansRouter.patch(
  "/update-plan-draft/:placeId/:planId",
  authorizePermission(PlacePermission.CREATE_EVENT),
  updateDraftPlan,
);

placePlansRouter.post(
  "/update-plan-draft/:place_id",
  authorizePermission(PlacePermission.SUBMIT_PLAN),
  submitToPreReview,
);

//
placePlansRouter.get(
  "/get-plan-to-approve/:placeId",
  authorizePermission(PlacePermission.APPROVE_PLAN),
  get_pending_reviews,
);

placePlansRouter.put(
  "/update-plan-to-approve/:placeId/:planId",
  authorizePermission(PlacePermission.APPROVE_PLAN),
  adminUpdatePendingPlan,
);

placePlansRouter.post(
  "/approve-plan/:placeId",
  authorizePermission(PlacePermission.APPROVE_PLAN),
  approve_place_plans,
);

// placePlansRouter.post(
//   "/merge-plan-to-one/:placeId",
//   authorizePermission(PlacePermission.MERGE_PLANS),
//   merge_plan_to_one,
// );

//
placePlansRouter.put(
  "/update-approved-plan/:placeId/:planId",
  authorizePermission([PlacePermission.EDIT_PLAN, PlacePermission.DELETE_PLAN]),
  updateApprovedPlan,
);

export default placePlansRouter;
