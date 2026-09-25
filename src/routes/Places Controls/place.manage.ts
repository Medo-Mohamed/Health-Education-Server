import { Router } from "express";
import { authorizePermission } from "../../middleware/validateCreatePlace";
import { upload } from "../../Config/cloudinary";
import { PlacePermission } from "../../types/placeAccess";
import {
  createPlace,
  getPlaceDetails,
  updatePlace,
  validateParentPlace,
} from "../../Controlers/Place.manage";

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
