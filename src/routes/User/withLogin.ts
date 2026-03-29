import { Router } from "express";
import { isAuthenticated } from "../../middleware/isAuth.ts";
import { logout, refreshauth } from "../../Controlers/Users.ts";
const router = Router();
router.use(isAuthenticated);

router.route("/refreshauth").get(refreshauth);

router.route("/logout").post(logout);

export default router;
