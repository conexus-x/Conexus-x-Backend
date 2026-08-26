import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import { moduleFrom, requireModuleAccess } from "../middleware/access.middleware";

import {
    getRecordAmendments,
    createAmendment,
    updateAmendment,
    deleteAmendment
} from "../controllers/amendment.controller";

const router = Router();

/**
 * Amendments hang off a record, so listing and posting are addressed through
 * it; editing and deleting address the amendment itself, whose own `module`
 * field is what the access check resolves. The two id shapes share a path
 * segment without colliding because no verb is used for both.
 */

router.get(

    "/:recordId",
    protect,

    requireModuleAccess(moduleFrom.recordParam),

    getRecordAmendments

);

router.post(

    "/:recordId",
    protect,

    requireModuleAccess(moduleFrom.recordParam),

    createAmendment

);

router.put(

    "/:amendmentId",
    protect,

    requireModuleAccess(moduleFrom.amendmentParam),

    updateAmendment

);

router.delete(

    "/:amendmentId",
    protect,

    requireModuleAccess(moduleFrom.amendmentParam),

    deleteAmendment

);

export default router;
