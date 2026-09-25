import { Router } from "express";
import { isInCharge } from "../../middleware/isDevOrAdmin";
import { upload } from "../../Config/cloudinary";
import { deleteFile, getFiles, uploadFile } from "../../Controlers/Files";

const router = Router();

router.route("/").get(getFiles);
router.use(isInCharge);
router.route("/upload").post(upload.single("file"), uploadFile, getFiles);
router.delete("/:id", deleteFile);
// router.route("/download").get();

export default router;
