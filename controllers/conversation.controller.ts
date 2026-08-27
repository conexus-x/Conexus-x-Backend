// controllers/conversation.controller.ts

import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import Conversation from "../models/Conversation";
import Message from "../models/Message";
import WorkspaceMember from "../models/WorkspaceMember";
import Workspace from "../models/Workspace";
import { getMembership } from "../services/access.service";
import {
    canMessageDirectly,
    meetCapabilities,
    myWorkspaceRoles
} from "../services/meetAccess.service";
import { effectiveStatus } from "../services/presence.service";
import { emitChange, originOf } from "../services/realtime.service";

/**
 * Conexus Meet — the threads themselves. Messages live in message.controller.ts.
 *
 * ACCESS IS MEMBERSHIP OF THE CONVERSATION, checked on every route, and it is
 * NARROWER than workspace membership: being in the workspace lets you START a
 * thread with someone, never read one you were not added to.
 */

/** What each participant is rendered as — never the raw user document. */
const MEMBER_FIELDS = "firstName lastName email avatar status lastSeen";

/**
 * Presence is DERIVED and the raw pick is stripped, exactly as
 * getWorkspaceMembers and publicCreator do. Someone set to "appear offline"
 * must look offline in the chat list too — a second read path that forgot this
 * would leak the one thing that whole feature exists to hide.
 */
const publicUser = (user: any) => {
    if (!user || typeof user !== "object") return user;

    const { status, lastSeen, ...rest } = user._doc ?? user;

    return { ...rest, presence: effectiveStatus({ status, lastSeen }) };
};

/** Shapes one conversation for the client, from the caller's point of view. */
const publicConversation = (
    doc: any,
    userId: string,
    unread = 0,
    /** The caller's role in the workspace this thread belongs to. */
    myRole?: string
) => {
    const members = (doc.members ?? []).map((m: any) => ({
        user: publicUser(m.user),
        isAdmin: m.isAdmin,
        joinedAt: m.joinedAt,
        lastReadAt: m.lastReadAt
    }));

    /**
     * A direct thread has no stored name — it is named after WHOEVER YOU ARE
     * NOT. Resolving that here rather than on the client means the title, the
     * avatar and the presence dot all come from one place and cannot disagree.
     */
    const other =
        doc.kind === "direct"
            ? members.find((m: any) => String(m.user?._id) !== String(userId))
            : null;

    /**
     * The thread names its own workspace. Meet spans every workspace the
     * person belongs to, so a row that only carried an id would leave the list
     * unable to say WHERE a conversation lives without a second lookup per row.
     */
    const workspace =
        doc.workspace && typeof doc.workspace === "object"
            ? {
                _id: String(doc.workspace._id),
                name: doc.workspace.name ?? "",
                icon: doc.workspace.icon ?? ""
            }
            : { _id: String(doc.workspace), name: "", icon: "" };

    return {
        _id: doc._id,
        workspace,
        /** What the caller may do here — the client greys controls from this. */
        myRole: myRole ?? null,
        kind: doc.kind,
        name: doc.kind === "direct" ? "" : doc.name,
        icon: doc.icon,
        members,
        createdBy: doc.createdBy,
        lastMessage: doc.lastMessage,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        /** Present only on a direct thread; the client titles the row with it. */
        counterpart: other?.user ?? null,
        unread
    };
};

const isMember = (doc: any, userId: string) =>
    (doc?.members ?? []).some((m: any) => String(m.user?._id ?? m.user) === String(userId));

const isAdmin = (doc: any, userId: string) =>
    (doc?.members ?? []).some(
        (m: any) => String(m.user?._id ?? m.user) === String(userId) && m.isAdmin
    );

/**
 * Who may rename a team, invite to it, or remove from it.
 *
 * TWO WAYS TO QUALIFY, and the second is the point of this helper: the team's
 * own admins (whoever created it, plus anyone promoted), OR an owner/admin of
 * the WORKSPACE the team lives in. Workspace managers already administer
 * boards, members and roles; a team they can see but cannot moderate would be
 * the one object in the product that escapes them.
 *
 * The workspace lookup only happens when the cheap in-document check fails, so
 * the ordinary case still costs nothing.
 */
const canAdministerTeam = async (doc: any, userId: string): Promise<boolean> => {
    if (isAdmin(doc, userId)) return true;

    const membership = await getMembership(
        String(doc.workspace?._id ?? doc.workspace),
        userId
    );

    return Boolean(membership && meetCapabilities(membership.role).canManageAnyTeam);
};

/**
 * Unread counts for many threads in ONE aggregate.
 *
 * The obvious implementation — countDocuments per conversation — is a query per
 * row on the screen that is nothing but rows. This groups messages newer than
 * each member's lastReadAt in a single pass.
 */
const unreadFor = async (
    conversations: any[],
    userId: string
): Promise<Map<string, number>> => {
    const out = new Map<string, number>();
    if (!conversations.length) return out;

    const conditions = conversations.map((c) => {
        const mine = (c.members ?? []).find(
            (m: any) => String(m.user?._id ?? m.user) === String(userId)
        );

        return {
            conversation: c._id,
            // No lastReadAt means never opened — everything counts.
            createdAt: { $gt: mine?.lastReadAt ?? new Date(0) }
        };
    });

    const rows = await Message.aggregate([
        {
            $match: {
                $or: conditions,
                isDeleted: false,
                // Your own message is never unread to you.
                sender: { $ne: new mongoose.Types.ObjectId(userId) }
            }
        },
        { $group: { _id: "$conversation", n: { $sum: 1 } } }
    ]);

    rows.forEach((r: any) => out.set(String(r._id), r.n));

    return out;
};

/**
 * GET /api/conversations
 *
 * EVERY thread the caller is in, across EVERY workspace they belong to.
 *
 * This used to be scoped to one workspace, and that was wrong in practice: an
 * owner or admin who belongs to several had to leave Meet, switch workspace in
 * the sidebar and come back merely to answer someone -- and a message waiting
 * in another workspace was invisible until they happened to switch to it. A
 * chat list is a list of PEOPLE, not a facet of whichever board is open.
 *
 * Nothing is loosened by doing this. Access was never workspace membership: it
 * is membership of the CONVERSATION, which is strictly narrower, so the same
 * threads are returned either way -- they just no longer arrive one workspace
 * at a time.
 */
export const listConversations = async (req: AuthRequest, res: Response) => {
    try {
        const userId = String(req.user?.id);

        // Their role per workspace, resolved once for the whole page rather
        // than per row -- the rows are the thing there are many of.
        const roles = await myWorkspaceRoles(userId);

        if (roles.size === 0) {
            return res.json({ conversations: [] });
        }

        const conversations = await Conversation.find({
            workspace: { $in: [...roles.keys()] },
            "members.user": userId
        })
            .populate("members.user", MEMBER_FIELDS)
            .populate("workspace", "name icon")
            .sort({ "lastMessage.at": -1, updatedAt: -1 });

        const unread = await unreadFor(conversations, userId);

        res.json({
            conversations: conversations.map((c: any) =>
                publicConversation(
                    c,
                    userId,
                    unread.get(String(c._id)) ?? 0,
                    roles.get(String(c.workspace?._id ?? c.workspace))
                )
            )
        });
    } catch (error: any) {
        console.error("List conversations error:", error.message);
        res.status(500).json({ message: "Could not load conversations" });
    }
};

/**
 * GET /api/conversations/contacts
 *
 * Everyone the caller is allowed to start a conversation with, across all of
 * their workspaces, already grouped by workspace and already filtered by the
 * rules in meetAccess.service.
 *
 * ONE request rather than a getMembers call per workspace: the "new chat"
 * picker needs all of them at once, and N requests to draw one list is the
 * thing this endpoint exists to avoid. It also means the client never has to
 * decide who a guest may message -- it renders what it is given.
 */
export const listContacts = async (req: AuthRequest, res: Response) => {
    try {
        const userId = String(req.user?.id);

        const roles = await myWorkspaceRoles(userId);

        if (roles.size === 0) return res.json({ workspaces: [] });

        const ids = [...roles.keys()];

        const [workspaces, members] = await Promise.all([
            Workspace.find({ _id: { $in: ids } }).select("name icon").lean(),
            WorkspaceMember.find({
                workspace: { $in: ids },
                status: "active",
                user: { $ne: new mongoose.Types.ObjectId(userId) }
            })
                .populate("user", MEMBER_FIELDS)
                .lean()
        ]);

        const byWorkspace = new Map<string, any[]>();

        members.forEach((row: any) => {
            if (!row.user) return;

            const workspaceId = String(row.workspace);
            const myRole = roles.get(workspaceId);
            if (!myRole) return;

            /**
             * A GUEST sees only owners and admins here. The refusal is enforced
             * again in openDirectConversation -- this list is a convenience, and
             * a convenience is never the permission.
             */
            if (myRole === "guest" && row.role !== "owner" && row.role !== "admin") {
                return;
            }

            const list = byWorkspace.get(workspaceId) ?? [];
            list.push({ ...publicUser(row.user), role: row.role });
            byWorkspace.set(workspaceId, list);
        });

        res.json({
            workspaces: workspaces
                .map((w: any) => ({
                    _id: String(w._id),
                    name: w.name,
                    icon: w.icon ?? "",
                    myRole: roles.get(String(w._id)) ?? null,
                    capabilities: meetCapabilities(roles.get(String(w._id)) as any),
                    people: (byWorkspace.get(String(w._id)) ?? []).sort((a: any, b: any) =>
                        String(a.firstName).localeCompare(String(b.firstName))
                    )
                }))
                // A workspace with nobody reachable in it is a dead heading.
                .filter((w: any) => w.people.length > 0)
        });
    } catch (error: any) {
        console.error("List contacts error:", error.message);
        res.status(500).json({ message: "Could not load your contacts" });
    }
};

/**
 * POST /api/conversations/:workspaceId/direct  { userId }
 *
 * IDEMPOTENT BY DESIGN. Clicking a person twice must land in the SAME thread,
 * so this looks for the existing pair before creating one — otherwise the
 * history splits in two and each person answers in a different copy.
 */
export const openDirectConversation = async (req: AuthRequest, res: Response) => {
    try {
        const { workspaceId } = req.params;
        const me = String(req.user?.id);
        const them = String(req.body?.userId ?? "");

        if (!mongoose.isValidObjectId(them)) {
            return res.status(400).json({ message: "A valid person is required" });
        }

        if (them === me) {
            return res.status(400).json({ message: "You cannot message yourself" });
        }

        /**
         * BOTH roles decide this, not just membership — a guest may only reach
         * an owner or admin. The rule lives in meetAccess.service so the picker
         * that offers people and the endpoint that acts cannot disagree.
         */
        const refusal = await canMessageDirectly(String(workspaceId), me, them);

        if (refusal) {
            return res.status(403).json({ message: refusal });
        }

        let conversation = await Conversation.findOne({
            workspace: workspaceId,
            kind: "direct",
            "members.user": { $all: [me, them] },
            // $all matches a superset, so the size guard is what keeps this to
            // the pair and not a group that happens to contain both.
            members: { $size: 2 }
        });

        if (!conversation) {
            conversation = await Conversation.create({
                workspace: workspaceId,
                kind: "direct",
                createdBy: me,
                members: [
                    { user: me, isAdmin: false, lastReadAt: new Date() },
                    { user: them, isAdmin: false, lastReadAt: null }
                ]
            });
        }

        await conversation.populate("members.user", MEMBER_FIELDS);

        const shaped = publicConversation(conversation, me);

        /**
         * Announced to BOTH people's personal rooms, not to the workspace: a
         * new direct thread is nobody else's business, and the other person's
         * list has to grow a row without them reloading.
         */
        emitChange({
            entity: "conversation",
            action: "created",
            id: String(conversation._id),
            workspaceId: String(workspaceId),
            audience: [me, them],
            data: shaped,
            actorId: me,
            originId: originOf(req)
        });

        res.status(200).json({ conversation: shaped });
    } catch (error: any) {
        console.error("Open direct conversation error:", error.message);
        res.status(500).json({ message: "Could not open that conversation" });
    }
};

// POST /api/conversations/:workspaceId/group  { name, icon, memberIds[] }
export const createGroup = async (req: AuthRequest, res: Response) => {
    try {
        const { workspaceId } = req.params;
        const me = String(req.user?.id);

        const name = String(req.body?.name ?? "").trim();
        if (!name) {
            return res.status(400).json({ message: "A team needs a name" });
        }

        const membership = await getMembership(String(workspaceId), me);
        if (!membership) {
            return res.status(403).json({ message: "Not a member of this workspace" });
        }

        /**
         * A guest may not assemble people. They see only the boards shared with
         * them by design, and creating a team is a way of gathering staff.
         */
        if (!meetCapabilities(membership.role).canCreateTeam) {
            return res.status(403).json({
                message: "Guests cannot create teams"
            });
        }

        const requested: string[] = Array.isArray(req.body?.memberIds)
            ? req.body.memberIds.map(String)
            : [];

        /**
         * Every invitee is re-checked against the workspace. The client only
         * offers people who are in it, but a client is not a permission system,
         * and an id posted by hand must not add an outsider to a team.
         */
        const valid = requested.length
            ? await WorkspaceMember.find({
                workspace: workspaceId,
                user: { $in: requested.filter((id) => mongoose.isValidObjectId(id)) },
                status: "active"
            }).select("user").lean()
            : [];

        const memberIds = [
            ...new Set([me, ...valid.map((row: any) => String(row.user))])
        ];

        const conversation = await Conversation.create({
            workspace: workspaceId,
            kind: "group",
            name,
            icon: String(req.body?.icon ?? ""),
            createdBy: me,
            members: memberIds.map((id) => ({
                user: id,
                // The creator runs the team; everyone else is added to it.
                isAdmin: id === me,
                lastReadAt: id === me ? new Date() : null
            }))
        });

        await conversation.populate("members.user", MEMBER_FIELDS);

        const shaped = publicConversation(conversation, me);

        emitChange({
            entity: "conversation",
            action: "created",
            id: String(conversation._id),
            workspaceId: String(workspaceId),
            audience: memberIds,
            data: shaped,
            actorId: me,
            originId: originOf(req)
        });

        res.status(201).json({ conversation: shaped });
    } catch (error: any) {
        console.error("Create group error:", error.message);
        res.status(500).json({ message: "Could not create the team" });
    }
};

// PUT /api/conversations/:conversationId  { name, icon }
export const updateConversation = async (req: AuthRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const me = String(req.user?.id);

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        if (conversation.kind === "direct") {
            return res.status(400).json({ message: "A direct conversation cannot be renamed" });
        }

        if (!(await canAdministerTeam(conversation, me))) {
            return res.status(403).json({ message: "Only a team admin can change this" });
        }

        if (typeof req.body?.name === "string") {
            const name = req.body.name.trim();
            if (!name) {
                return res.status(400).json({ message: "A team needs a name" });
            }
            conversation.name = name;
        }

        if (typeof req.body?.icon === "string") {
            conversation.icon = req.body.icon;
        }

        await conversation.save();
        await conversation.populate("members.user", MEMBER_FIELDS);

        emitChange({
            entity: "conversation",
            action: "updated",
            id: String(conversation._id),
            workspaceId: String(conversation.workspace),
            conversationId: String(conversation._id),
            data: publicConversation(conversation, me),
            actorId: me,
            originId: originOf(req)
        });

        res.json({ conversation: publicConversation(conversation, me) });
    } catch (error: any) {
        console.error("Update conversation error:", error.message);
        res.status(500).json({ message: "Could not save that change" });
    }
};

// POST /api/conversations/:conversationId/members  { memberIds[] }
export const addMembers = async (req: AuthRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const me = String(req.user?.id);

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        if (conversation.kind === "direct") {
            return res.status(400).json({
                message: "A direct conversation is between two people — create a team instead"
            });
        }

        if (!(await canAdministerTeam(conversation, me))) {
            return res.status(403).json({ message: "Only a team admin can invite people" });
        }

        const requested: string[] = Array.isArray(req.body?.memberIds)
            ? req.body.memberIds.map(String).filter((id: string) => mongoose.isValidObjectId(id))
            : [];

        const valid = await WorkspaceMember.find({
            workspace: conversation.workspace,
            user: { $in: requested },
            status: "active"
        }).select("user").lean();

        const existing = new Set(
            conversation.members.map((m: any) => String(m.user))
        );

        const added = valid
            .map((row: any) => String(row.user))
            .filter((id: string) => !existing.has(id));

        /**
         * Nobody new — either they are all in the team already, or none of the
         * ids survived the workspace re-check. `added` is returned EMPTY rather
         * than omitted: a caller reading `added.length` must not have to know
         * which path answered it.
         */
        if (!added.length) {
            return res.status(200).json({
                message: "Nobody new to add",
                added: [],
                conversation: publicConversation(
                    await conversation.populate("members.user", MEMBER_FIELDS),
                    me
                )
            });
        }

        added.forEach((id) =>
            conversation.members.push({
                user: new mongoose.Types.ObjectId(id),
                isAdmin: false,
                joinedAt: new Date(),
                lastReadAt: null
            } as any)
        );

        await conversation.save();
        await conversation.populate("members.user", MEMBER_FIELDS);

        const shaped = publicConversation(conversation, me);

        /**
         * Everyone in the thread, including the people just added — their
         * client has never seen this conversation and needs the whole row, not
         * a patch to something it does not have.
         */
        emitChange({
            entity: "conversation",
            action: "updated",
            id: String(conversation._id),
            workspaceId: String(conversation.workspace),
            conversationId: String(conversation._id),
            audience: conversation.members.map((m: any) => String(m.user?._id ?? m.user)),
            data: shaped,
            actorId: me,
            originId: originOf(req)
        });

        res.json({ conversation: shaped, added });
    } catch (error: any) {
        console.error("Add members error:", error.message);
        res.status(500).json({ message: "Could not add those people" });
    }
};

/**
 * DELETE /api/conversations/:conversationId/members/:userId
 *
 * One route for two things a person reads as different: an admin removing
 * someone, and someone leaving. They are the same write, and the only rule is
 * that you may always remove YOURSELF.
 */
export const removeMember = async (req: AuthRequest, res: Response) => {
    try {
        const { conversationId, userId } = req.params;
        const me = String(req.user?.id);
        const target = String(userId);

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        if (conversation.kind === "direct") {
            return res.status(400).json({ message: "A direct conversation cannot be left" });
        }

        const leaving = target === me;

        if (!leaving && !(await canAdministerTeam(conversation, me))) {
            return res.status(403).json({ message: "Only a team admin can remove people" });
        }

        const before = conversation.members.length;

        conversation.members = conversation.members.filter(
            (m: any) => String(m.user) !== target
        ) as any;

        if (conversation.members.length === before) {
            return res.status(404).json({ message: "That person is not in this team" });
        }

        /**
         * A team whose last admin walked out is unmanageable — nobody could
         * rename it or invite anyone again. The longest-standing member is
         * promoted rather than leaving the thread stranded.
         */
        const hasAdmin = conversation.members.some((m: any) => m.isAdmin);
        if (!hasAdmin && conversation.members.length) {
            conversation.members[0].isAdmin = true;
        }

        if (!conversation.members.length) {
            // Nobody left to read it. Messages go with it — see deleteMessages.
            await Message.deleteMany({ conversation: conversation._id });
            await Conversation.deleteOne({ _id: conversation._id });

            emitChange({
                entity: "conversation",
                action: "deleted",
                id: String(conversationId),
                workspaceId: String(conversation.workspace),
                conversationId: String(conversationId),
                audience: [me],
                actorId: me,
                originId: originOf(req)
            });

            return res.json({ message: "Conversation removed" });
        }

        await conversation.save();
        await conversation.populate("members.user", MEMBER_FIELDS);

        // The removed person is told too, so the thread disappears from their
        // list instead of sitting there until they click it and get a 403.
        emitChange({
            entity: "conversation",
            action: "updated",
            id: String(conversation._id),
            workspaceId: String(conversation.workspace),
            conversationId: String(conversation._id),
            audience: [
                ...conversation.members.map((m: any) => String(m.user?._id ?? m.user)),
                target
            ],
            data: publicConversation(conversation, me),
            actorId: me,
            originId: originOf(req)
        });

        res.json({
            message: leaving ? "You left the team" : "Member removed",
            conversation: publicConversation(conversation, me)
        });
    } catch (error: any) {
        console.error("Remove member error:", error.message);
        res.status(500).json({ message: "Could not update the team" });
    }
};

/**
 * POST /api/conversations/:conversationId/read
 *
 * Stamps the caller's lastReadAt. That is the ONLY thing an unread count is
 * derived from, so this is the whole of "mark as read".
 */
export const markRead = async (req: AuthRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const me = String(req.user?.id);

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        if (!isMember(conversation, me)) {
            return res.status(403).json({ message: "You are not in this conversation" });
        }

        const at = new Date();

        await Conversation.updateOne(
            { _id: conversationId, "members.user": me },
            { $set: { "members.$.lastReadAt": at } }
        );

        /**
         * Sent to the READER'S OWN room, not the thread's. Reading is a fact
         * about one person's other tabs; broadcasting it to the room would be a
         * read receipt, which is a different feature with different consent.
         */
        emitChange({
            entity: "conversation",
            action: "updated",
            id: String(conversationId),
            workspaceId: String(conversation.workspace),
            conversationId: String(conversationId),
            audience: [me],
            data: { _id: conversationId, unread: 0, lastReadAt: at },
            actorId: me,
            originId: originOf(req)
        });

        res.json({ message: "Marked as read", lastReadAt: at });
    } catch (error: any) {
        console.error("Mark read error:", error.message);
        res.status(500).json({ message: "Could not mark that as read" });
    }
};
