import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import {
    createModule,
    getWorkspaceModules,
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



router.delete(
    "/:moduleId",
    protect,
    deleteModule
);

export default router;