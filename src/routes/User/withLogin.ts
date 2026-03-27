import { Router } from "express";
import { isAuthenticated } from "../../middleware/isAuth.ts";
import { logout } from "../../Controlers/Users.ts";
const router = Router();
router.use(isAuthenticated);

router.route("/logout").post(logout);

export default router;
