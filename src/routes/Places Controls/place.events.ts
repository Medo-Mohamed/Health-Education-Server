import { Router } from "express";
import { authorizePermission } from "../../middleware/validateCreatePlace";
import { PlacePermission } from "../../types/placeAccess";
import {
  checkCanCreatePlaceEvent,
  createPlaceEvent,
  deleteEvent,
  updateEvent,
} from "../../Controlers/Place.event";

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

placeEventsRouter.put(
  "/update-event/:placeId/:eventId",
  authorizePermission(PlacePermission.EDIT_EVENT),
  updateEvent,
);

placeEventsRouter.delete(
  "/delete-event/:placeId/:eventId",
  authorizePermission(PlacePermission.DELETE_EVENT),
  deleteEvent,
);

export default placeEventsRouter;
