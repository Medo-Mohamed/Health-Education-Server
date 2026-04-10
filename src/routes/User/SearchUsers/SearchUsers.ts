import express from "express";
import { searchUsers } from "../../../Controlers/Users.ts";
const router = express.Router();

router.route("/getusers").get(searchUsers);
export default router;
