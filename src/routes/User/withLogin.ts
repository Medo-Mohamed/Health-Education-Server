import { Router } from "express";
import { isAuthenticated } from "../../middleware/isAuth.ts";
import {
  logout,
  profileDisplay,
  refreshauth,
  updateProfile,
} from "../../Controlers/Users.ts";
import { upload } from "../../middleware/upload.ts";

const router = Router();
router.use(isAuthenticated);

router.route("/refreshauth").get(refreshauth);

router.route("/profile").get(profileDisplay);

router.route("/profile").patch(upload.single("avatar"), updateProfile);

router.route("/logout").post(logout);

export default router;
