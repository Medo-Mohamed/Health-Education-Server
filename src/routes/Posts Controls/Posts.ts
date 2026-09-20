import { Router } from "express";
import { isInCharge } from "../../middleware/isDevOrAdmin.ts";
import { upload } from "../../Config/cloudinary.ts";
import { createPost, getAllPosts } from "../../Controlers/Posts.ts";
import "../../Config/deleteFilesAuto.ts";
const router = Router();

router.route("/").get(getAllPosts);

router.use(isInCharge);

router.route("/create").post(upload.single("file"), createPost);



export default router;
