import { Router } from "express";
import { isInCharge } from "../../middleware/isDevOrAdmin";
import { upload } from "../../Config/cloudinary";
import { createPost, getAllPosts } from "../../Controlers/Posts";
import "../../Config/deleteFilesAuto";
const router = Router();

router.route("/").get(getAllPosts);

router.use(isInCharge);

router.route("/create").post(upload.single("file"), createPost);



export default router;
