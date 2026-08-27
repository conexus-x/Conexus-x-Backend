// services/meetAccess.service.ts

import mongoose from "mongoose";
import WorkspaceMember, { MemberRole } from "../models/WorkspaceMember";
import { isWorkspaceManager } from "./access.service";

/**
 * WHO MAY TALK TO WHOM — the single source of truth for Conexus Meet.
 *
 * Nothing else may re-implement these. Controllers ask; the client mirrors them
 * in app/lib/meetRoles.ts purely to grey out controls, and the server re-checks
 * every one.
 *
 * The rules, and why each is where it is:
 *
 *   DIRECT MESSAGES — everyone except a guest may message anyone else in the
 *   workspace. A GUEST may only open a thread with an owner or admin. Guests
 *   are external people who by design see only the boards shared with them, so
 *   letting one message every employee would hand them the org chart, which is
 *   precisely what guest access exists to withhold. The people who invited them
 *   are who they need to reach.
 *
 *   TEAMS — a guest may not create one (same reasoning: a team is a way to
 *   assemble people, and a guest should not be assembling staff). Everybody
 *   else may, and whoever creates a team administers it.
 *
 *   MANAGING SOMEONE ELSE'S TEAM — owners and admins only. They already manage
 *   boards, members and roles; a team is the same kind of object. A member
 *   administers the teams they made and no others.
 */

export interface MeetCapabilities {
    role: MemberRole;
    canStartDirect: boolean;
    canCreateTeam: boolean;
    /** Rename, invite and remove in ANY team in this workspace. */
    canManageAnyTeam: boolean;
}

export const meetCapabilities = (role: MemberRole): MeetCapabilities => ({
    role,
    canStartDirect: true,
    canCreateTeam: role !== "guest",
    canManageAnyTeam: isWorkspaceManager(role)
});

/**
 * May `actor` open a direct thread with `target` in this workspace?
 *
 * Returns null when allowed, or the refusal message. Both sides are looked up
 * here rather than by the caller, because the answer depends on BOTH roles and
 * splitting that across two call sites is how the two halves drift.
 */
export const canMessageDirectly = async (
    workspaceId: string,
    actorId: string,
    targetId: string
): Promise<string | null> => {
    if (!mongoose.isValidObjectId(workspaceId)) return "Unknown workspace";

    const rows = await WorkspaceMember.find({
        workspace: workspaceId,
        user: { $in: [actorId, targetId] },
        status: "active"
    }).select("user role").lean();

    const actor = rows.find((r: any) => String(r.user) === String(actorId));
    const target = rows.find((r: any) => String(r.user) === String(targetId));

    if (!actor) return "You are not a member of this workspace";
    if (!target) return "That person is not in this workspace";

    // The one restriction. Everyone else may reach everyone else.
    if (actor.role === "guest" && !isWorkspaceManager(target.role as MemberRole)) {
        return "As a guest you can only message workspace owners and admins";
    }

    return null;
};

/** Every workspace the user is an ACTIVE member of, with their role in each. */
export const myWorkspaceRoles = async (
    userId: string
): Promise<Map<string, MemberRole>> => {
    const rows = await WorkspaceMember.find({
        user: userId,
        status: "active"
    }).select("workspace role").lean();

    return new Map(
        rows.map((r: any) => [String(r.workspace), r.role as MemberRole])
    );
};
