import { Router } from "express";
import {
    getModuleAutomations,
    getWorkspaceAutomations,
    createAutomation,
    createWorkspaceAutomation,
    updateAutomation,
    deleteAutomation
} from "../controllers/automation.controller";
import { protect } from "../middleware/auth.middleware";
import {
    moduleFrom,
    requireAutomationAccess,
    requireModuleAccess
} from "../middleware/access.middleware";

const router = Router();

router.use(protect);

/**
 * Workspace-scoped recipes FIRST, so `/workspace/<id>` can never be read as a
 * module id by the single-segment routes below.
 *
 * These carry no requireModuleAccess: there is no module to check, so the
 * controller gates on workspace membership instead.
 *
 * There is deliberately NO /runs route. What a recipe DID is an activity row
 * (the engine stamps metadata.automation on it), so it is read from
 * GET /api/activity/:workspaceId?source=automation — one store, one read path.
 */
router.get("/workspace/:workspaceId", getWorkspaceAutomations);
router.post("/workspace/:workspaceId", createWorkspaceAutomation);

// Nested by parent module on list/create, keyed by own id on update/delete.
router.get("/:moduleId", requireModuleAccess(moduleFrom.param), getModuleAutomations);
router.post("/:moduleId", requireModuleAccess(moduleFrom.param), createAutomation);
// requireAutomationAccess, not moduleFrom.automationParam: a workspace-scoped
// recipe has no module for that resolver to find.
router.put("/:automationId", requireAutomationAccess, updateAutomation);
router.delete("/:automationId", requireAutomationAccess, deleteAutomation);

export default router;
