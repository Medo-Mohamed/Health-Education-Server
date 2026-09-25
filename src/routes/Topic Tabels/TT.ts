import { Router } from "express";
import { isInCharge } from "../../middleware/isDevOrAdmin";
import {
  createTopicTable,
  deleteTopic,
  getAllTablesSummary,
  getTablesSummary,
  updateTableRows,
  updateTitleAndDec,
} from "../../Controlers/TopicsTables";

const router = Router();

router.route("/display").get(getAllTablesSummary);

router.route("/displayonetable/:id").get(getTablesSummary);

router.use(isInCharge);

router.route("/create").post(createTopicTable);

router.route("/titleanddesc").patch(updateTitleAndDec);

router.route("/rows").patch(updateTableRows);

router.route("/delete/:id").delete(deleteTopic);

export default router;
