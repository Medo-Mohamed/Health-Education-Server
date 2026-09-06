import { Router } from "express";
import { authorizePermission } from "../../middleware/validateCreatePlace.ts";
import { upload } from "../../Config/cloudinary.ts";
import { getMyPlaces } from "../../Controlers/Places.ts";
import { PlacePermission } from "../../types/placeAccess.ts";
import placeManageRouters from "./place.manage.ts";
import placeEmployeeRouters from "./place.employee.ts";
import placeEventsRouter from "./place.events.ts";
import placePlansRouter from "./place.plans.ts";

const placesRouters = Router();

placesRouters.use("/place-manage", placeManageRouters);

placesRouters.use("/place-staff", placeEmployeeRouters);

placesRouters.use("/place-events", placeEventsRouter);

placesRouters.use("/place-plans", placePlansRouter);

placesRouters.get("/my-places", getMyPlaces);

export default placesRouters;
