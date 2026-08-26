import { Response } from "express";
import mongoose from "mongoose";
import { accessibleModuleIds } from "../services/access.service";
import { AuthRequest } from "./wrokspace.controller";
import Activity from "../models/Activity";
import Automation from "../models/Automation";
import UserModel from "../models/User";
import WorkspaceMember from "../models/WorkspaceMember";
import env from "../config/env";
import {
    canRevert,
    markReverted,
    revertActivity,
    revertBlocker
} from "../services/activityRevert.service";

/**
 * Read side of the audit trail. One endpoint, narrowed by query params, because
 * the workspace / module / record feeds differ only by filter.
 *
 * AUTOMATION RUNS ARE ROWS IN HERE — there is no second store and there must
 * never be one. The engine writes an ordinary Activity row stamped with
 * metadata.automation, so "what did the automation do" and "what happened on
 * this module" are the same question asked with a different filter. `source`
 * is that filter, and labelRuns() below turns the stamp into something the UI
 * can render as a badge.
 */

const MAX_LIMIT = 100;

/**
 * Attaches the recipe behind every automated row, and the person whose edit set
 * it off.
 *
 * The name is read from metadata.automationName, stamped at write time. Older
 * rows predate that, so they fall back to a lookup — one query for the whole
 * page, never one per row — and only then to a placeholder. A recipe can be
 * deleted while its rows survive, which is why the stamp exists at all.
 *
 * It also strips the `automation "<name>" ` prefix from the message. That
 * prefix makes the raw row self-describing in the database; on screen the name
 * is already the badge, so leaving it in the sentence says it twice.
 */
async function labelRuns<
    T extends { message?: string; metadata?: unknown; user?: unknown }
>(rows: T[]) {
    type Meta = {
        automation?: string;
        automationName?: string;
        triggeredBy?: string;
    };

    const metaOf = (row: T) => (row.metadata ?? {}) as Meta;

    // Only rows with no stamped name need looking up.
    const unnamed = Array.from(
        new Set(
            rows
                .filter((row) => metaOf(row).automation && !metaOf(row).automationName)
                .map((row) => String(metaOf(row).automation))
        )
    );

    const recipes = unnamed.length
        ? await Automation.find({ _id: { $in: unnamed } }).select("name").lean()
        : [];

    const nameById = new Map(recipes.map((r) => [String(r._id), r.name]));

    // Who triggered them, named in one query so the feed can say "via …".
    const triggerIds = Array.from(
        new Set(
            rows
                .map((row) => String(metaOf(row).triggeredBy ?? ""))
                .filter(Boolean)
        )
    );

    const people = triggerIds.length
        ? await UserModel.find({ _id: { $in: triggerIds } })
            .select("firstName lastName email avatar")
            .lean()
        : [];

    const personById = new Map(people.map((p) => [String(p._id), p]));

    return rows.map((row) => {
        const meta = metaOf(row);
        if (!meta.automation) return { ...row, automation: null, triggeredBy: null };

        /**
         * Third fallback: read the name back out of the message.
         *
         * Rows written before the name was stamped, whose recipe has since been
         * deleted, have no other source — and "An automation" throws away the
         * one fact that makes the row explicable when the name is sitting right
         * there in the text.
         *
         * Anchored on the engine's OWN verbs, and greedy.
         *
         * Neither half is optional. Non-greedy breaks on an auto-generated name
         * that contains quotes (`When Status becomes "Delivered", …`) — it stops
         * at the first one and cuts the name in half. Plain greedy breaks on the
         * common case, because the message body is full of quoted record names
         * and it runs past the real closing quote into them. Requiring one of
         * the verbs the action handlers actually write is what makes exactly one
         * position match. Verified against all three message shapes.
         */
        const nameFromMessage = String(row.message ?? "").match(
            /^automation "(.+)" (?:set|cleared|moved|archived|marked|renamed|added|created|posted) /
        )?.[1];

        const name =
            meta.automationName ||
            nameById.get(String(meta.automation)) ||
            nameFromMessage ||
            "An automation";

        return {
            ...row,
            automation: { _id: String(meta.automation), name },
            triggeredBy: meta.triggeredBy
                ? personById.get(String(meta.triggeredBy)) ?? null
                : null,
            message: String(row.message ?? "")
                .replace(`automation "${name}" `, "")
                .trim()
        };
    });
}

// GET /api/activity/:workspaceId?moduleId=&recordId=&userId=&action=&source=&limit=&before=
export const getWorkspaceActivity = async (req: AuthRequest, res: Response) => {
    try {
        const workspaceId = String(req.params.workspaceId ?? "");

        if (!mongoose.isValidObjectId(workspaceId)) {
            return res.status(400).json({ message: "Invalid workspace id" });
        }

        // The feed exposes who did what across the workspace — members only.
        const membership = await WorkspaceMember.findOne({
            workspace: workspaceId,
            user: req.user?.id,
            status: "active"
        });

        if (!membership) {
            return res.status(403).json({ message: "Not a member of this workspace" });
        }

        const { moduleId, recordId, userId, action, source, before } = req.query;

        const limit = Math.min(
            Math.max(Number(req.query.limit) || 50, 1),
            MAX_LIMIT
        );

        const filter: Record<string, unknown> = {
            workspace: new mongoose.Types.ObjectId(workspaceId)
        };

        if (moduleId && mongoose.isValidObjectId(String(moduleId))) {
            filter.module = new mongoose.Types.ObjectId(String(moduleId));
        }

        if (recordId && mongoose.isValidObjectId(String(recordId))) {
            filter.record = new mongoose.Types.ObjectId(String(recordId));
        }

        if (userId && mongoose.isValidObjectId(String(userId))) {
            filter.user = new mongoose.Types.ObjectId(String(userId));
        }

        if (action) {
            filter.action = { $in: String(action).split(",").map((a) => a.trim()) };
        }

        /**
         * Who did it: an automation, or a person acting directly. Both are
         * attributed to the same USER (the engine logs against whoever's edit
         * set the recipe off), so the stamp is the only thing that separates
         * them — which is exactly why it is a filter here and not a second
         * collection somewhere.
         */
        if (source === "automation") {
            filter["metadata.automation"] = { $exists: true };
        } else if (source === "person") {
            filter["metadata.automation"] = { $exists: false };
        }

        /**
         * The feed names boards, records and cells, so it has to obey board
         * access too — otherwise a private board leaks through its audit trail.
         * Workspace-level rows (no module) stay visible to every member.
         */
        const accessible = await accessibleModuleIds(
            String(req.user?.id ?? ""),
            workspaceId,
            membership.role
        );

        if (accessible !== "all") {
            filter.$or = [
                { module: { $exists: false } },
                { module: null },
                { module: { $in: accessible } }
            ];
        }

        // Keyset pagination on createdAt — stable while new rows land on top.
        if (before) {
            const cursor = new Date(String(before));
            if (!isNaN(cursor.getTime())) {
                filter.createdAt = { $lt: cursor };
            }
        }

        const activities = await Activity.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            // Populate the "where": the feed shows a breadcrumb, and these names
            // are the only way to render it without an extra round-trip per row.
            .populate("user", "firstName lastName email avatar")
            .populate("module", "name")
            .populate("collectionName", "name color")
            .populate("record", "name")
            .populate("column", "name type")
            .lean();

        const hasMore = activities.length > limit;
        const page = hasMore ? activities.slice(0, limit) : activities;

        // Revertability is decided here, not in the client — the rules live in
        // one place and the button cannot drift from what the API will allow.
        const rows = await labelRuns(
            page.map((row) => ({
                ...row,
                canRevert: canRevert(row),
                revertBlocker: revertBlocker(row)
            }))
        );

        res.json({
            activities: rows,
            hasMore,
            // Feed this back as `before` to fetch the next page.
            nextCursor: hasMore ? page[page.length - 1]?.createdAt : null,
            retentionDays: Number(env.activity_retention_days) || 0
        });

    } catch (error: any) {
        console.error("Activity feed error:", error.message);
        res.status(500).json({ message: "Could not load activity" });
    }
};


// POST /api/activity/:workspaceId/:activityId/revert
export const revertActivityEntry = async (req: AuthRequest, res: Response) => {
    try {
        const workspaceId = String(req.params.workspaceId ?? "");
        const activityId = String(req.params.activityId ?? "");

        if (!mongoose.isValidObjectId(workspaceId) || !mongoose.isValidObjectId(activityId)) {
            return res.status(400).json({ message: "Invalid id" });
        }

        // Only members with write access may undo. A guest can read the feed but
        // must not be able to rewrite records through it.
        const membership = await WorkspaceMember.findOne({
            workspace: workspaceId,
            user: req.user?.id,
            status: "active"
        });

        if (!membership) {
            return res.status(403).json({ message: "Not a member of this workspace" });
        }

        if (membership.role === "guest") {
            return res.status(403).json({ message: "Guests cannot revert changes" });
        }

        const activity = await Activity.findOne({
            _id: activityId,
            workspace: workspaceId
        });

        if (!activity) {
            return res.status(404).json({ message: "Activity entry not found" });
        }

        const outcome = await revertActivity(activity, String(req.user?.id));

        if (!outcome.ok) {
            return res.status(409).json({ message: outcome.reason });
        }

        await markReverted(activity._id, String(req.user?.id));

        res.json({ message: outcome.message ?? "Change reverted" });

    } catch (error: any) {
        console.error("Activity revert error:", error.message);
        res.status(500).json({ message: "Could not revert this change" });
    }
};
