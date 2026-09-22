import { Router } from "express";
import { authorizePermission } from "../../middleware/validateCreatePlace.ts";
import { upload } from "../../Config/cloudinary.ts";
import { PlacePermission } from "../../types/placeAccess.ts";
import {
  createPlace,
  getPlaceDetails,
  updatePlace,
  validateParentPlace,
} from "../../Controlers/Place.manage.ts";

const placeManageRouters = Router();

placeManageRouters
  .route("/create")
  .post(
    upload.single("photo"),
    authorizePermission(PlacePermission.CREATE_SUB_PLACE),
    createPlace,
  );

placeManageRouters.get(
  "/:id",
  authorizePermission(PlacePermission.VIEW_PLACE),
  getPlaceDetails,
);

placeManageRouters
  .route("/update/:placeId")
  .put(
    upload.single("photo"),
    authorizePermission(PlacePermission.EDIT_PLACE_INFO),
    updatePlace,
  );

placeManageRouters.get("/:parentId/validate-parent", validateParentPlace);

export default placeManageRouters;
