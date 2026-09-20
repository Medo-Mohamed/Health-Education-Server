import { Router } from "express";
import { isInCharge } from "../../middleware/isDevOrAdmin.ts";
import { upload } from "../../Config/cloudinary.ts";
import { deleteFile, getFiles, uploadFile } from "../../Controlers/Files.ts";

const router = Router();

router.route("/").get(getFiles);
router.use(isInCharge);
router.route("/upload").post(upload.single("file"), uploadFile, getFiles);
router.delete("/:id", deleteFile);
// router.route("/download").get();

export default router;
