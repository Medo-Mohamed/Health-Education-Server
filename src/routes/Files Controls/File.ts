import { Router } from "express";
import { isInCharge } from "../../middleware/isDevOrAdmin.ts";
import { upload } from "../../Config/cloudinary.ts";
import { getFiles, uploadFile } from "../../Controlers/Files.ts";
import axios from "axios";
const router = Router();

router.route("/").get(getFiles);
router.use(isInCharge);
router.route("/upload").post(upload.single("file"), uploadFile, getFiles);
router.route("/view-pdf").get(async (req, res) => {
  console.log("Received request to view PDF with URL:", req.query.url);
  const { url } = req.query;
  try {
    const response = await axios.get(url as string, { responseType: "stream" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline"); // إجبار العرض
    response.data.pipe(res);
  } catch (error) {
    res.status(500).send("Error loading PDF");
  }
});
// router.route("/download").get();

export default router;
