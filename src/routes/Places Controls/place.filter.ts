import { Router } from "express";
import { filterEventsAndPlans, getPlacesAndSchedules } from "../../Controlers/Places.ts";
import { authorizePermission } from "../../middleware/validateCreatePlace.ts";
import { PlacePermission } from "../../types/placeAccess.ts";

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
