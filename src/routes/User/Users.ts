import { Router } from "express";

import withLogin from "../withLogin.ts";
import withoutLogin from "../withoutLogin.ts";

const router = Router();

router.use("/withlogin", withLogin);
router.use("/withoutlogin", withoutLogin);

export default router;
