import { Router } from "express";
import { isAuthenticated } from "../../middleware/isAuth.ts";
import {
  followUser,
  logout,
  profileDisplay,
  refreshauth,
  unfollowUser,
  updateProfile,
} from "../../Controlers/Users.ts";
import { upload } from "../../middleware/upload.ts";
import searchRoutes from "./SearchUsers/SearchUsers.ts";
import { isDev } from "../../middleware/isDevOrAdmin.ts";
import DevRouters from "./Dev End points/devUsers.ts";
const router = Router();
router.use(isAuthenticated);

router.route("/refreshauth").get(refreshauth);

router.route("/profile").get(profileDisplay);

router.route("/profile").patch(upload.single("avatar"), updateProfile);

router.route("/logout").post(logout);

router.route("/followuser/:id").post(followUser);

router.route("/unfollowuser/:id").post(unfollowUser);

router.use("/search", searchRoutes);

router.use("/dev", DevRouters);

export default router;
