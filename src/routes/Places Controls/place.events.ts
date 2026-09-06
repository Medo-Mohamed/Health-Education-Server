import { Router } from "express";
import { authorizePermission } from "../../middleware/validateCreatePlace.ts";
import { PlacePermission } from "../../types/placeAccess.ts";
import { checkCanCreatePlaceEvent, createPlaceEvent } from "../../Controlers/Places.ts";

const placeEventsRouter = Router();

placeEventsRouter.get(
  "/check-can-create/:placeId",
  authorizePermission(PlacePermission.CREATE_EVENT),
  checkCanCreatePlaceEvent,
);

placeEventsRouter.post(
  "/save-event/:placeId",
  authorizePermission(PlacePermission.CREATE_EVENT),
  createPlaceEvent,
);

export default placeEventsRouter;
