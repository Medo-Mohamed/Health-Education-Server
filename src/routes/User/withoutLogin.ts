import { Router } from "express";
import {
  changePassword,
  confirmOtpCode,
  createUsers,
  login,
  lostPassword,
} from "../../Controlers/Users.ts";
import { isNotAuthenticated } from "../../middleware/isAuth.ts";

const router = Router();
router.use(isNotAuthenticated);

router.route("/register").post(createUsers);

router.post("/login", login);

router.post("/forgetpassword", lostPassword);

router.post("/confirmotp", confirmOtpCode);

router.post("/allowchangepassword", changePassword);

export default router;
