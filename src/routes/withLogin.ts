import { Router } from "express";
import { isAuthenticated } from "../middleware/isAuth.ts";
import {
  followUser,
  getFollowingList,
  logout,
  profileDisplay,
  refreshauth,
  unfollowUser,
  updateProfile,
} from "../Controlers/Users.ts";
import { upload } from "../middleware/upload.ts";
import searchRoutes from "./User/SearchUsers/SearchUsers.ts";
import { isDev } from "../middleware/isDevOrAdmin.ts";
import DevRouters from "./User/Dev End points/devUsers.ts";
import topicTabels from "./Topic Tabels/TT.ts";
import Files from "./Files Controls/File.ts";
import postsRoutes from "./Posts Controls/Posts.ts";
import placesRouters from "./Places Controls/place.ts";
const router = Router();
router.use(isAuthenticated);

router.route("/refreshauth").get(refreshauth);

router.route("/profile/:id").get(profileDisplay);

router.route("/profile/:id").patch(upload.single("avatar"), updateProfile);

router.route("/logout").post(logout);

router.route("/followuser/:id").post(followUser);

router.route("/unfollowuser/:id").post(unfollowUser);

router.route("/getfollowinglist").get(getFollowingList);

router.use("/search", searchRoutes);

router.use("/dev", DevRouters);

router.use("/topictabels", topicTabels);

router.use("/files", Files);

router.use("/posts", postsRoutes);

router.use("/places", placesRouters);

export default router;
