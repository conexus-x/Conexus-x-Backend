import { Router } from "express";
import {
    getWorkspaceActivity,
    revertActivityEntry
} from "../controllers/activity.controller";
import { protect } from "../middleware/auth.middleware";

const router = Router();

router.use(protect);

router.get("/:workspaceId", getWorkspaceActivity);
router.post("/:workspaceId/:activityId/revert", revertActivityEntry);

export default router;
