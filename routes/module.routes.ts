import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import { moduleFrom, requireModuleAccess } from "../middleware/access.middleware";
import {
    createModule,
    getWorkspaceModules,
    updateModule,
    deleteModule
} from "../controllers/module.controller";


const router = Router();



router.post(
    "/:workspaceId",
    protect,
    createModule
);



router.get(
    "/:workspaceId",
    protect,
    getWorkspaceModules
);



router.put(
    "/:moduleId",
    protect,
    requireModuleAccess(moduleFrom.param),
    updateModule
);



router.delete(
    "/:moduleId",
    protect,
    requireModuleAccess(moduleFrom.param),
    deleteModule
);

export default router;