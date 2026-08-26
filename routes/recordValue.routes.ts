import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import { moduleFrom, requireModuleAccess } from "../middleware/access.middleware";

import {

    createRecordValue,

    getRecordValues,

    updateRecordValue,

    deleteRecordValue,

    getModuleReferences

} from "../controllers/recordValue.controller";

const router = Router();

router.post(

    "/",
    protect,

    requireModuleAccess(moduleFrom.recordBody),

    createRecordValue

);

router.get(

    "/references/:moduleId",
    protect,

    requireModuleAccess(moduleFrom.param),

    getModuleReferences

);

router.get(

    "/:recordId",
    protect,

    requireModuleAccess(moduleFrom.recordParam),

    getRecordValues

);

router.put(

    "/:recordValueId",
    protect,

    requireModuleAccess(moduleFrom.recordValueParam),

    updateRecordValue

);

router.delete(

    "/:recordValueId",
    protect,

    requireModuleAccess(moduleFrom.recordValueParam),

    deleteRecordValue

);

export default router;