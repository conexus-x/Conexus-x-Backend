import { Router } from "express";

import {
    createWorkspace,
    deleteWorkspace,
    getWorkspace,
    getWorkspaces,
    updateWorkspace
} from "../controllers/wrokspace.controller";

import { protect } from "../middleware/auth.middleware";


const router = Router();


router.post(
    "/",
    protect,
    createWorkspace
);


router.get(
    "/",
    protect,
    getWorkspaces
);


router.get(
    "/:id",
    protect,
    getWorkspace
);


router.put(
    "/:id",
    protect,
    updateWorkspace
);


router.delete(
    "/:id",
    protect,
    deleteWorkspace
);


export default router;