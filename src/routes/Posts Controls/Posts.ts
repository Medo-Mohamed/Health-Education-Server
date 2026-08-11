import { Router } from "express";
import { isInCharge } from "../../middleware/isDevOrAdmin.ts";
import { upload } from "../../Config/cloudinary.ts";
import { createPost, getAllPosts } from "../../Controlers/Posts.ts";

const router = Router();

router.route("/").get(getAllPosts);

router.use(isInCharge);
// router.route("/create").get((req, res) => {
//   return res.status(200).json({ message: "تم استلام طلب إنشاء المنشور" }); // للتأكد من وصول الطلب
// });
router.route("/create").post(upload.single("file"), createPost);

export default router;
