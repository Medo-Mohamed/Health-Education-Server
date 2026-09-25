import { Router } from "express";
import {
  changePassword,
  confirmOtpCode,
  createUsers,
  login,
  lostPassword,
} from "../Controlers/Users";
import { isNotAuthenticated } from "../middleware/isAuth";
import asyncHandler from "../utils/asyncHandler";

const router = Router();
router.use(isNotAuthenticated);

router.route("/register").post(asyncHandler(createUsers));

router.post("/login", asyncHandler(login));

router.post("/forgetpassword", asyncHandler(lostPassword));

router.post("/confirmotp", asyncHandler(confirmOtpCode));

router.post("/allowchangepassword", asyncHandler(changePassword));

export default router;
