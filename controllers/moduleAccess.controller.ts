// controllers/moduleAccess.controller.ts

import { Request, Response } from "express";
import mongoose from "mongoose";
import Module from "../models/Module";
import ModuleMember from "../models/ModuleMember";
import WorkspaceMember from "../models/WorkspaceMember";
import { touchWorkspace } from "../utils/workspaceHelper";
import { logActivity } from "../services/activity.service";
import { emitChange, originOf } from "../services/realtime.service";
import {
    ModuleVisibility,
    decideModuleAccess,
    getMembership,
    isWorkspaceManager
} from "../services/access.service";

interface AuthRequest extends Request {
    user?: { id: string };
}

/**
 * Board access for one person in one workspace.
 *
 * The GET returns every board with the answer already worked out — `granted`
 * (a row exists), `openToRole` (their workspace role already lets them in), and
 * `canAccess` (what actually happens). The panel renders that verbatim so it can
 * never disagree with the server.
 */

// GET /api/module-access/:workspaceId/:userId
export const getMemberModuleAccess = async (req: AuthRequest, res: Response) => {

    try {

        const { workspaceId, userId } = req.params;

        if (
            !mongoose.isValidObjectId(String(workspaceId)) ||
            !mongoose.isValidObjectId(String(userId))
        ) {
            return res.status(400).json({ message: "Invalid workspace or user id" });
        }

        // Only someone who runs the workspace may read who can see what.
        const actor = await getMembership(String(workspaceId), String(req.user?.id));

        if (!isWorkspaceManager(actor?.role)) {
            return res.status(403).json({
                message: "Only an owner or admin can view board access"
            });
        }

        const target = await WorkspaceMember.findOne({
            workspace: workspaceId,
            user: userId
        });

        if (!target) {
            return res.status(404).json({
                message: "Member not found in this workspace"
            });
        }

        const [modules, grants] = await Promise.all([
            Module.find({ workspace: workspaceId, isArchived: false })
                .select("name icon color visibility createdBy")
                .sort({ createdAt: 1 })
                .lean(),
            ModuleMember.find({ workspace: workspaceId, user: userId })
                .select("module")
                .lean()
        ]);

        const grantedIds = new Set(grants.map((grant) => String(grant.module)));

        const rows = modules.map((moduleItem) => {
            const granted = grantedIds.has(String(moduleItem._id));
            const isCreator = String(moduleItem.createdBy) === String(userId);

            // What their role alone would give them, ignoring any grant.
            const openToRole = decideModuleAccess({
                role: target.role,
                visibility: moduleItem.visibility as ModuleVisibility,
                hasGrant: false,
                isCreator
            }).allowed;

            const canAccess = decideModuleAccess({
                role: target.role,
                visibility: moduleItem.visibility as ModuleVisibility,
                hasGrant: granted,
                isCreator
            }).allowed;

            return {
                _id: String(moduleItem._id),
                name: moduleItem.name,
                icon: moduleItem.icon,
                color: moduleItem.color,
                visibility: moduleItem.visibility,
                granted,
                openToRole,
                canAccess,
                isCreator
            };
        });

        return res.json({ role: target.role, modules: rows });

    } catch (error: any) {

        console.error("Board access read error:", error.message);

        return res.status(500).json({ message: "Server error" });

    }

};


// PUT /api/module-access/:workspaceId/:userId  { moduleIds: string[] }
export const setMemberModuleAccess = async (req: AuthRequest, res: Response) => {

    try {

        const { workspaceId, userId } = req.params;
        const { moduleIds } = req.body;

        if (
            !mongoose.isValidObjectId(String(workspaceId)) ||
            !mongoose.isValidObjectId(String(userId))
        ) {
            return res.status(400).json({ message: "Invalid workspace or user id" });
        }

        if (!Array.isArray(moduleIds)) {
            return res.status(400).json({ message: "moduleIds must be an array" });
        }

        const actor = await getMembership(String(workspaceId), String(req.user?.id));

        if (!isWorkspaceManager(actor?.role)) {
            return res.status(403).json({
                message: "Only an owner or admin can change board access"
            });
        }

        const target = await WorkspaceMember.findOne({
            workspace: workspaceId,
            user: userId
        }).populate("user", "firstName lastName email");

        if (!target) {
            return res.status(404).json({
                message: "Member not found in this workspace"
            });
        }

        // Ids are only honoured if they name a live board in THIS workspace —
        // a grant must never be able to point somewhere else.
        const requested = moduleIds
            .filter((id: unknown) => mongoose.isValidObjectId(String(id)))
            .map((id: unknown) => String(id));

        const valid = await Module.find({
            _id: { $in: requested },
            workspace: workspaceId,
            isArchived: false
        }).select("_id name");

        const validIds = valid.map((moduleItem) => String(moduleItem._id));

        const existing = await ModuleMember.find({
            workspace: workspaceId,
            user: userId
        }).select("module");

        const existingIds = existing.map((grant) => String(grant.module));

        const toAdd = validIds.filter((id) => !existingIds.includes(id));
        const toRemove = existingIds.filter((id) => !validIds.includes(id));

        if (toAdd.length > 0) {
            await ModuleMember.insertMany(
                toAdd.map((moduleId) => ({
                    module: new mongoose.Types.ObjectId(moduleId),
                    workspace: new mongoose.Types.ObjectId(String(workspaceId)),
                    user: new mongoose.Types.ObjectId(String(userId)),
                    grantedBy: req.user?.id
                        ? new mongoose.Types.ObjectId(req.user.id)
                        : undefined
                })),
                // A duplicate means someone granted the same board concurrently —
                // the end state is identical, so it must not fail the request.
                { ordered: false }
            ).catch((error: any) => {
                if (error?.code !== 11000) throw error;
            });
        }

        if (toRemove.length > 0) {
            await ModuleMember.deleteMany({
                workspace: workspaceId,
                user: userId,
                module: { $in: toRemove.map((id) => new mongoose.Types.ObjectId(id)) }
            });
        }

        if (toAdd.length === 0 && toRemove.length === 0) {
            return res.json({ message: "Board access unchanged", moduleIds: validIds });
        }

        await touchWorkspace(String(workspaceId));

        const targetUser = target.user as unknown as {
            firstName?: string;
            lastName?: string;
            email?: string;
        } | null;

        const memberLabel =
            `${targetUser?.firstName ?? ""} ${targetUser?.lastName ?? ""}`.trim() ||
            targetUser?.email ||
            "a member";

        const summary = [
            toAdd.length ? `granted ${toAdd.length}` : "",
            toRemove.length ? `revoked ${toRemove.length}` : ""
        ]
            .filter(Boolean)
            .join(" and ");

        await logActivity({
            workspace: String(workspaceId),
            user: req.user?.id,
            action: "module_access_changed",
            targetName: memberLabel,
            before: existingIds,
            after: validIds,
            message: `${summary} board${toAdd.length + toRemove.length === 1 ? "" : "s"} for ${memberLabel}`,
            metadata: {
                memberUserId: String(userId),
                added: toAdd,
                removed: toRemove
            }
        });

        // Granting someone a board changes THEIR module list, so this also has
        // to reach a person who is not looking at the members page at all.
        emitChange({
            entity: "moduleAccess",
            action: "updated",
            id: `${workspaceId}:${userId}`,
            workspaceId: String(workspaceId),
            actorId: req.user?.id,
            originId: originOf(req)
        });

        return res.json({
            message: "Board access updated",
            moduleIds: validIds
        });

    } catch (error: any) {

        console.error("Board access write error:", error.message);

        return res.status(500).json({ message: "Server error" });

    }

};
