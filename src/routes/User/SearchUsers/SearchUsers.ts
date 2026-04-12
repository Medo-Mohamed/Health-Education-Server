import express from "express";
import { findOneUser, searchUsers } from "../../../Controlers/Users.ts";
const router = express.Router();

router.route("/getusers").get(searchUsers);
router.route("/getuser/:id").get(findOneUser);
export default router;
