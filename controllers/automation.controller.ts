import { Response } from "express";
import mongoose from "mongoose";
import { paginationMeta, parsePagination } from "../utils/pagination";
import { AuthRequest } from "./wrokspace.controller";
import Automation from "../models/Automation";
import Module from "../models/Module";
import WorkspaceMember from "../models/WorkspaceMember";
import { touchWorkspace } from "../utils/workspaceHelper";
import { sanitiseRecipe, validateRecipe } from "../services/automation/recipe";
import { emitChange, originOf } from "../services/realtime.service";

/**
 * Automation CRUD.
 *
 * A recipe is scoped one of two ways. MODULE scope pins it to one board, which
 * is what lets its trigger and conditions name that board's columns by id.
 * WORKSPACE scope runs it against every board in the workspace, addressing
 * columns by NAME instead — see models/Automation.ts for why those cannot be
 * mixed.
 *
 * Sanitising and validating live in services/automation/recipe.ts, so the
 * engine and this controller cannot disagree about what a valid recipe is.
 */

/** Membership gate — recipes rewrite records, so guests are read-only. */
async function assertCanEdit(
    workspaceId: mongoose.Types.ObjectId | string,
    userId?: string
): Promise<string | null> {
    const membership = await WorkspaceMember.findOne({
        workspace: workspaceId,
        user: userId,
        status: "active"
    });

    if (!membership) return "Not a member of this workspace";
    if (membership.role === "guest") return "Guests cannot change automations";
    return null;
}

// GET /api/automations/:moduleId
export const getModuleAutomations = async (req: AuthRequest, res: Response) => {
    try {
        const moduleId = String(req.params.moduleId ?? "");

        if (!mongoose.isValidObjectId(moduleId)) {
            return res.status(400).json({ message: "Invalid module id" });
        }

        const moduleItem = await Module.findById(moduleId);
        if (!moduleItem) return res.status(404).json({ message: "Module not found" });

        const membership = await WorkspaceMember.findOne({
            workspace: moduleItem.workspace,
            user: req.user?.id,
            status: "active"
        });

        if (!membership) {
            return res.status(403).json({ message: "Not a member of this workspace" });
        }

        const pagination = parsePagination(req.query);

        const query = Automation.find({ module: moduleId })
            .sort({ createdAt: -1 })
            .populate("createdBy", "firstName lastName email avatar")
            .lean();

        if (pagination.enabled) {
            query.skip(pagination.skip).limit(pagination.limit);
        }

        const automations = await query;

        if (!pagination.enabled) {
            return res.json({ automations });
        }

        res.json({
            automations,
            pagination: paginationMeta(
                await Automation.countDocuments({ module: moduleId }),
                pagination
            )
        });

    } catch (error: any) {
        console.error("Automation list error:", error.message);
        res.status(500).json({ message: "Could not load automations" });
    }
};

// POST /api/automations/:moduleId
export const createAutomation = async (req: AuthRequest, res: Response) => {
    try {
        const moduleId = String(req.params.moduleId ?? "");

        const moduleItem = await Module.findById(moduleId);
        if (!moduleItem) return res.status(404).json({ message: "Module not found" });

        const denied = await assertCanEdit(moduleItem.workspace, req.user?.id);
        if (denied) return res.status(403).json({ message: denied });

        const recipe = sanitiseRecipe(req.body ?? {}, "module");
        const invalid = validateRecipe(recipe);
        if (invalid) return res.status(400).json({ message: invalid });

        const automation = await Automation.create({
            ...recipe,
            workspace: moduleItem.workspace,
            module: moduleItem._id,
            isActive: req.body?.isActive !== false,
            createdBy: req.user?.id
        });

        await touchWorkspace(moduleItem.workspace);

        emitChange({
            entity: "automation",
            action: "created",
            id: String(automation._id),
            workspaceId: String(moduleItem.workspace),
            moduleId: String(moduleItem._id),
            data: automation,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(201).json({ message: "Automation created", automation });

    } catch (error: any) {
        console.error("Automation create error:", error.message);
        res.status(500).json({ message: "Could not create the automation" });
    }
};

/* ------------------------------------------------------------------ *
 * Workspace-scoped recipes
 *
 * These two routes carry no requireModuleAccess, because there is no module to
 * check — they gate on workspace membership instead. That is the right test:
 * a workspace recipe is authored against the workspace, and the engine still
 * only ever fires it on a module the EVENT happened on, so it cannot reach a
 * board the triggering user could not already write to.
 * ------------------------------------------------------------------ */

// GET /api/automations/workspace/:workspaceId
export const getWorkspaceAutomations = async (req: AuthRequest, res: Response) => {
    try {
        const workspaceId = String(req.params.workspaceId ?? "");

        if (!mongoose.isValidObjectId(workspaceId)) {
            return res.status(400).json({ message: "Invalid workspace id" });
        }

        const membership = await WorkspaceMember.findOne({
            workspace: workspaceId,
            user: req.user?.id,
            status: "active"
        });

        if (!membership) {
            return res.status(403).json({ message: "Not a member of this workspace" });
        }

        const automations = await Automation.find({
            workspace: workspaceId,
            scope: "workspace"
        })
            .sort({ createdAt: -1 })
            .populate("createdBy", "firstName lastName email avatar")
            .lean();

        res.json({ automations });

    } catch (error: any) {
        console.error("Workspace automation list error:", error.message);
        res.status(500).json({ message: "Could not load automations" });
    }
};

// POST /api/automations/workspace/:workspaceId
export const createWorkspaceAutomation = async (req: AuthRequest, res: Response) => {
    try {
        const workspaceId = String(req.params.workspaceId ?? "");

        if (!mongoose.isValidObjectId(workspaceId)) {
            return res.status(400).json({ message: "Invalid workspace id" });
        }

        const denied = await assertCanEdit(workspaceId, req.user?.id);
        if (denied) return res.status(403).json({ message: denied });

        const recipe = sanitiseRecipe(req.body ?? {}, "workspace");
        const invalid = validateRecipe(recipe);
        if (invalid) return res.status(400).json({ message: invalid });

        const automation = await Automation.create({
            ...recipe,
            workspace: workspaceId,
            // Null, not absent: this is what the engine's $or reads to tell a
            // workspace recipe from one pinned to a board.
            module: null,
            isActive: req.body?.isActive !== false,
            createdBy: req.user?.id
        });

        await touchWorkspace(workspaceId);

        emitChange({
            entity: "automation",
            action: "created",
            id: String(automation._id),
            workspaceId: String(workspaceId),
            data: automation,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(201).json({ message: "Automation created", automation });

    } catch (error: any) {
        console.error("Workspace automation create error:", error.message);
        res.status(500).json({ message: "Could not create the automation" });
    }
};

// PUT /api/automations/:automationId
export const updateAutomation = async (req: AuthRequest, res: Response) => {
    try {
        const automationId = String(req.params.automationId ?? "");

        const existing = await Automation.findById(automationId);
        if (!existing) return res.status(404).json({ message: "Automation not found" });

        const denied = await assertCanEdit(existing.workspace, req.user?.id);
        if (denied) return res.status(403).json({ message: denied });

        // A toggle sends only isActive — do not demand a whole recipe for it.
        const isToggleOnly =
            Object.keys(req.body ?? {}).length === 1 &&
            typeof req.body?.isActive === "boolean";

        if (isToggleOnly) {
            existing.isActive = req.body.isActive;
            await existing.save();
            await touchWorkspace(existing.workspace);
            return res.json({ message: "Automation updated", automation: existing });
        }

        /**
         * Scope is read from the STORED recipe, never from the body. Flipping
         * a module recipe to workspace scope (or back) would leave every
         * column reference addressed the wrong way — an id where a name is
         * needed, or the reverse — so scope is fixed at creation and a change
         * of mind is a new recipe.
         */
        const recipe = sanitiseRecipe(req.body ?? {}, existing.scope);
        const invalid = validateRecipe(recipe);
        if (invalid) return res.status(400).json({ message: invalid });

        existing.set({
            ...recipe,
            isActive: req.body?.isActive !== false,
            // A rewritten recipe starts from a clean slate.
            lastError: ""
        });

        await existing.save();
        await touchWorkspace(existing.workspace);

        emitChange({
            entity: "automation",
            action: "updated",
            id: String(existing._id),
            workspaceId: String(existing.workspace),
            moduleId: existing.module ? String(existing.module) : undefined,
            data: existing,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.json({ message: "Automation updated", automation: existing });

    } catch (error: any) {
        console.error("Automation update error:", error.message);
        res.status(500).json({ message: "Could not update the automation" });
    }
};

// DELETE /api/automations/:automationId
export const deleteAutomation = async (req: AuthRequest, res: Response) => {
    try {
        const automationId = String(req.params.automationId ?? "");

        const existing = await Automation.findById(automationId);
        if (!existing) return res.status(404).json({ message: "Automation not found" });

        const denied = await assertCanEdit(existing.workspace, req.user?.id);
        if (denied) return res.status(403).json({ message: denied });

        await Automation.deleteOne({ _id: automationId });
        await touchWorkspace(existing.workspace);

        emitChange({
            entity: "automation",
            action: "deleted",
            id: String(existing._id),
            workspaceId: String(existing.workspace),
            moduleId: existing.module ? String(existing.module) : undefined,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.json({ message: "Automation deleted" });

    } catch (error: any) {
        console.error("Automation delete error:", error.message);
        res.status(500).json({ message: "Could not delete the automation" });
    }
};
