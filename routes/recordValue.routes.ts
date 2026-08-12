import { Router } from "express";
import { protect } from "../middleware/auth.middleware";

import {

    createRecordValue,

    getRecordValues,

    updateRecordValue,

    deleteRecordValue

} from "../controllers/recordValue.controller";

const router = Router();

router.post(

    "/",
    protect,

    createRecordValue

);

router.get(

    "/:recordId",
    protect,

    getRecordValues

);

router.put(

    "/:recordValueId",
    protect,

    updateRecordValue

);

router.delete(

    "/:recordValueId",
    protect,

    deleteRecordValue

);

export default router;