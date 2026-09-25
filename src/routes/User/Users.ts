import { Router } from "express";

import withLogin from "../withLogin";
import withoutLogin from "../withoutLogin";

const router = Router();

router.use("/withlogin", withLogin);
router.use("/withoutlogin", withoutLogin);

export default router;
