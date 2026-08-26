import { Router } from "express";
import { protect } from "../middleware/auth.middleware";
import {
    getMemberModuleAccess,
    setMemberModuleAccess
} from "../controllers/moduleAccess.controller";

const router = Router();

router.use(protect);

router.get("/:workspaceId/:userId", getMemberModuleAccess);
router.put("/:workspaceId/:userId", setMemberModuleAccess);

export default router;
