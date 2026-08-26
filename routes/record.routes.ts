import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import { moduleFrom, requireModuleAccess } from "../middleware/access.middleware";

import {

    createRecord,

    getCollectionRecords,

    createSubRecord,

    getSubRecords,

    updateRecord,

    deleteRecord

} from "../controllers/record.controller";

const router = Router();

router.post(

    "/:collectionId",
    protect,

    requireModuleAccess(moduleFrom.collectionParam),

    createRecord

);

router.get(

    "/:collectionId",
    protect,

    requireModuleAccess(moduleFrom.collectionParam),

    getCollectionRecords

);

/**
 * Sub-records hang off a record, so they are addressed through it. Both routes
 * carry two path segments, which is what keeps them from colliding with the
 * single-segment collection routes above.
 */
router.post(

    "/:recordId/sub-records",
    protect,

    requireModuleAccess(moduleFrom.recordParam),

    createSubRecord

);

router.get(

    "/:recordId/sub-records",
    protect,

    requireModuleAccess(moduleFrom.recordParam),

    getSubRecords

);

// A sub-record IS a record: renaming, reordering and archiving one goes through
// the routes below unchanged, and the access check resolves its module the same way.
router.put(

    "/:recordId",
    protect,

    requireModuleAccess(moduleFrom.recordParam),

    updateRecord

);

router.delete(

    "/:recordId",
    protect,

    requireModuleAccess(moduleFrom.recordParam),

    deleteRecord

);

export default router;