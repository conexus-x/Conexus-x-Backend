// services/access.service.ts

import mongoose from "mongoose";
import Module from "../models/Module";
import ModuleMember from "../models/ModuleMember";
import WorkspaceMember, { MemberRole } from "../models/WorkspaceMember";

/**
 * Who can open which board — the single source of truth.
 *
 * The rules, in the order they are applied:
 *   1. not an active member of the workspace  -> no access at all
 *   2. owner / admin                          -> every board (they run the place)
 *   3. guest                                  -> ONLY boards granted explicitly
 *   4. member  · visibility workspace|public  -> yes
 *              · visibility private           -> only if granted, or they made it
 *
 * Nothing else may re-implement this. Controllers ask; middleware enforces; the
 * client mirrors it for greying out controls but never decides.
 */

export type ModuleVisibility = "private" | "workspace" | "public";

export interface AccessDecision {
    allowed: boolean;
    /** HTTP status to answer with when `allowed` is false. */
    status: number;
    message: string;
}

const DENY_NOT_MEMBER: AccessDecision = {
    allowed: false,
    status: 403,
    message: "Not a member of this workspace"
};

const DENY_NO_BOARD: AccessDecision = {
    allowed: false,
    status: 403,
    message: "You do not have access to this board"
};

const ALLOW: AccessDecision = { allowed: true, status: 200, message: "" };

export const isWorkspaceManager = (role?: MemberRole | null) =>
    role === "owner" || role === "admin";

export const getMembership = async (workspaceId: string, userId: string) => {
    if (!mongoose.isValidObjectId(workspaceId) || !mongoose.isValidObjectId(userId)) {
        return null;
    }

    return WorkspaceMember.findOne({
        workspace: workspaceId,
        user: userId,
        status: "active"
    });
};

/**
 * The rule table itself, with every input already resolved. Kept pure so the
 * list filter and the per-request gate cannot drift apart.
 */
export const decideModuleAccess = (input: {
    role?: MemberRole | null;
    visibility: ModuleVisibility;
    hasGrant: boolean;
    isCreator: boolean;
}): AccessDecision => {
    const { role, visibility, hasGrant, isCreator } = input;

    if (!role) return DENY_NOT_MEMBER;

    if (isWorkspaceManager(role)) return ALLOW;

    // A guest sees only what was handed to them, whatever the board's visibility.
    if (role === "guest") {
        return hasGrant ? ALLOW : DENY_NO_BOARD;
    }

    if (visibility === "workspace" || visibility === "public") return ALLOW;

    return hasGrant || isCreator ? ALLOW : DENY_NO_BOARD;
};

export interface ResolvedModuleAccess extends AccessDecision {
    moduleId?: string;
    workspaceId?: string;
    role?: MemberRole;
}

/** Full check for one board, used by the route middleware. */
export const resolveModuleAccess = async (
    userId: string | undefined,
    moduleId: string | undefined
): Promise<ResolvedModuleAccess> => {
    if (!userId) {
        return { allowed: false, status: 401, message: "Unauthorized" };
    }

    if (!moduleId || !mongoose.isValidObjectId(moduleId)) {
        return { allowed: false, status: 400, message: "Invalid board id" };
    }

    const moduleItem = await Module.findById(moduleId).select(
        "workspace visibility createdBy"
    );

    if (!moduleItem) {
        return { allowed: false, status: 404, message: "Board not found" };
    }

    const membership = await getMembership(String(moduleItem.workspace), userId);

    // Managers and workspace-visible boards never need the grant lookup.
    const needsGrant =
        Boolean(membership) &&
        !isWorkspaceManager(membership?.role) &&
        (membership?.role === "guest" || moduleItem.visibility === "private");

    const hasGrant = needsGrant
        ? Boolean(
            await ModuleMember.exists({ module: moduleItem._id, user: userId })
        )
        : false;

    const decision = decideModuleAccess({
        role: membership?.role,
        visibility: moduleItem.visibility as ModuleVisibility,
        hasGrant,
        isCreator: String(moduleItem.createdBy) === String(userId)
    });

    return {
        ...decision,
        moduleId: String(moduleItem._id),
        workspaceId: String(moduleItem.workspace),
        role: membership?.role
    };
};

/**
 * Mongo filter selecting the boards a user may see in one workspace. Returns
 * null when they may see none — callers should answer with an empty list rather
 * than building a query that matches everything.
 */
export const accessibleModuleFilter = async (
    userId: string,
    workspaceId: string,
    role?: MemberRole | null
): Promise<Record<string, unknown> | null> => {
    const base = {
        workspace: new mongoose.Types.ObjectId(workspaceId),
        isArchived: false
    };

    if (!role) return null;

    if (isWorkspaceManager(role)) return base;

    const grants = await ModuleMember.find({
        workspace: workspaceId,
        user: userId
    }).select("module");

    const grantedIds = grants.map((grant) => grant.module);

    if (role === "guest") {
        if (grantedIds.length === 0) return null;
        return { ...base, _id: { $in: grantedIds } };
    }

    // Members: everything the workspace shares, plus the private boards they
    // were granted or created themselves.
    return {
        ...base,
        $or: [
            { visibility: { $in: ["workspace", "public"] } },
            { _id: { $in: grantedIds } },
            { createdBy: new mongoose.Types.ObjectId(userId) }
        ]
    };
};

/** The ids only — used to scope the activity feed to boards you can open. */
export const accessibleModuleIds = async (
    userId: string,
    workspaceId: string,
    role?: MemberRole | null
): Promise<mongoose.Types.ObjectId[] | "all"> => {
    if (isWorkspaceManager(role)) return "all";

    const filter = await accessibleModuleFilter(userId, workspaceId, role);

    if (!filter) return [];

    const modules = await Module.find(filter).select("_id");

    return modules.map((moduleItem) => moduleItem._id as mongoose.Types.ObjectId);
};
