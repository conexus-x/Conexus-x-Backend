import { Router } from "express";

import {
    getWorkspaceMembers,
    addWorkspaceMember,
    removeWorkspaceMember
} from "../controllers/workspaceMember.controller";

import { protect } from "../middleware/auth.middleware";


const router = Router();



router.get(
    "/:workspaceId",
    protect,
    getWorkspaceMembers
);



router.post(
    "/:workspaceId",
    protect,
    addWorkspaceMember
);



router.delete(
    "/:workspaceId/:userId",
    protect,
    removeWorkspaceMember
);



export default router;