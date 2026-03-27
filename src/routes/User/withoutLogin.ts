import { Router } from "express";
import { createUsers, login } from "../../Controlers/Users.ts";
import { isNotAuthenticated } from "../../middleware/isAuth.ts";

const router = Router();
router.use(isNotAuthenticated);

router.route("/regester").post(createUsers);

router.post("/login", login);

export default router;
