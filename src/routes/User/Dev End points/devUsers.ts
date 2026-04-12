import { Router } from "express";
import { isDev } from "../../../middleware/isDevOrAdmin.ts";
import { toggleAdmin } from "../../../Controlers/Users.ts";
const router = Router();

router.use(isDev);

router.route("/toggleadmin").post(toggleAdmin);

export default router;
