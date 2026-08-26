import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import { moduleFrom, requireModuleAccess } from "../middleware/access.middleware";
import {
    createColumn,
    getModuleColumns,
    updateColumn,
    deleteColumn
} from "../controllers/column.controller";

const router=Router();


router.post(
    "/:moduleId",
    protect,
    requireModuleAccess(moduleFrom.param),
    createColumn
);


router.get(
    "/:moduleId",
    protect,
    requireModuleAccess(moduleFrom.param),
    getModuleColumns
);


router.put(
    "/:columnId",
    protect,
    requireModuleAccess(moduleFrom.columnParam),
    updateColumn
);


router.delete(
    "/:columnId",
    protect,
    requireModuleAccess(moduleFrom.columnParam),
    deleteColumn
);


export default router;