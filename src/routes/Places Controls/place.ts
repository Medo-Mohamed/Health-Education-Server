import { Router } from "express";
import { getMyPlaces } from "../../Controlers/Places";
import placeManageRouters from "./place.manage";
import placeEmployeeRouters from "./place.employee";
import placeEventsRouter from "./place.events";
import placePlansRouter from "./place.plans";
import placeFilterRouter from "./place.filter";

const placesRouters = Router();

placesRouters.use("/place-manage", placeManageRouters);

placesRouters.use("/place-staff", placeEmployeeRouters);

placesRouters.use("/place-events", placeEventsRouter);

placesRouters.use("/place-plans", placePlansRouter);

placesRouters.use("/place-filter", placeFilterRouter);

placesRouters.get("/my-places", getMyPlaces);

export default placesRouters;
