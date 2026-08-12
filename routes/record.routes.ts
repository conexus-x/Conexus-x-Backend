import { Router } from "express";
import { protect } from "../middleware/auth.middleware";

import {

    createRecord,

    getCollectionRecords,

    updateRecord,

    deleteRecord

} from "../controllers/record.controller";

const router = Router();

router.post(

    "/:collectionId",
    protect,

    createRecord

);

router.get(

    "/:collectionId",
    protect,

    getCollectionRecords

);

router.put(

    "/:recordId",
    protect,

    updateRecord

);

router.delete(

    "/:recordId",
    protect,

    deleteRecord

);

export default router;