import { Router } from "express";
import { isDev } from "../../../middleware/isDevOrAdmin";
import { toggleAdmin } from "../../../Controlers/Users";
const router = Router();

router.use(isDev);

router.route("/toggleadmin").post(toggleAdmin);

export default router;
