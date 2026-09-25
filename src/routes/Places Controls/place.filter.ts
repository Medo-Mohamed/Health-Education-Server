import { Router } from "express";
import { filterEventsAndPlans, getPlacesAndSchedules } from "../../Controlers/Place.filter";
import { authorizePermission } from "../../middleware/validateCreatePlace";
import { PlacePermission } from "../../types/placeAccess";

const placeFilterRouter = Router();

placeFilterRouter.get(
  "/places-and-schedules/:placeId",
  authorizePermission(PlacePermission.VIEW_PLAN),
  getPlacesAndSchedules,
);

placeFilterRouter.post(
  "/places-and-schedules-filtered/:placeId",
  authorizePermission(PlacePermission.VIEW_PLAN),
  filterEventsAndPlans,
);


export default placeFilterRouter;
