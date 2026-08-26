import mongoose from "mongoose";
import Activity, { type ActivityAction, type IActivity } from "../models/Activity";
import RecordValue from "../models/RecordValue";
import RecordModel from "../models/Record";
import Collection from "../models/Collection";
import Column from "../models/Column";
import { logActivity, describeValue } from "./activity.service";

/**
 * Undoing a logged change.
 *
 * Only actions that RESTORE a previous state are revertible. Two categories are
 * deliberately excluded:
 *
 *  - Creations (`*_created`). Undoing a create means deleting, which would take
 *    everything nested inside it with no way back. That is a destructive action
 *    wearing an "undo" label, so it stays a manual delete.
 *  - Hard deletions (`collection_deleted`, `column_deleted`, `module_deleted`).
 *    The rows are gone from the database; `before` holds only the name, not the
 *    contents, so there is nothing to restore.
 *
 * Reverting writes its own activity row. The audit trail must show the undo as
 * an event in its own right, not silently rewind.
 */

export const REVERTIBLE_ACTIONS: ReadonlySet<ActivityAction> = new Set<ActivityAction>([
    "cell_updated",
    "record_updated",
    "record_moved",
    "record_deleted",
    "collection_updated",
    "column_updated"
]);

/** Why a given row cannot be reverted — surfaced to the client verbatim. */
export function revertBlocker(activity: Pick<IActivity, "action" | "revertedAt">): string | null {
    if (activity.revertedAt) return "This change has already been reverted";

    if (!REVERTIBLE_ACTIONS.has(activity.action)) {
        if (activity.action.endsWith("_created")) {
            return "Undoing a creation would delete it and everything inside — delete it manually instead";
        }
        if (activity.action.endsWith("_deleted")) {
            return "The original data no longer exists, so it cannot be restored";
        }
        return "This kind of change cannot be reverted";
    }

    return null;
}

export function canRevert(activity: Pick<IActivity, "action" | "revertedAt">): boolean {
    return revertBlocker(activity) === null;
}

export interface RevertOutcome {
    ok: boolean;
    /** Present when ok is false — safe to show the user. */
    reason?: string;
    message?: string;
}

const asString = (value: unknown): string =>
    value === null || value === undefined ? "" : String(value);

/**
 * Applies the inverse of one logged change. Returns a reason instead of throwing
 * when the target has since been deleted — a stale feed must not 500.
 */
export async function revertActivity(
    activity: IActivity,
    userId: string
): Promise<RevertOutcome> {

    const blocker = revertBlocker(activity);
    if (blocker) return { ok: false, reason: blocker };

    const base = {
        workspace: activity.workspace,
        user: userId,
        module: activity.module,
        collectionName: activity.collectionName,
        record: activity.record,
        column: activity.column,
        targetName: activity.targetName,
        metadata: { revertOf: String(activity._id) }
    };

    switch (activity.action) {

        case "cell_updated": {
            if (!activity.record || !activity.column) {
                return { ok: false, reason: "This entry is missing the cell it changed" };
            }

            const cell = await RecordValue.findOne({
                record: activity.record,
                column: activity.column
            });

            if (!cell) {
                return { ok: false, reason: "That cell no longer exists" };
            }

            cell.value = activity.before ?? "";
            await cell.save();

            await logActivity({
                ...base,
                action: "cell_updated",
                before: activity.after,
                after: activity.before,
                message: `reverted ${activity.targetName || "a field"} back to ${describeValue(activity.before)}`
            });

            return { ok: true, message: "Change reverted" };
        }

        case "record_updated": {
            const record = await RecordModel.findById(activity.record);
            if (!record) return { ok: false, reason: "That record no longer exists" };

            record.name = asString(activity.before);
            await record.save();

            await logActivity({
                ...base,
                action: "record_updated",
                before: activity.after,
                after: activity.before,
                message: `reverted record name back to "${record.name}"`
            });

            return { ok: true, message: "Name reverted" };
        }

        case "record_moved": {
            const record = await RecordModel.findById(activity.record);
            if (!record) return { ok: false, reason: "That record no longer exists" };

            const target = asString(activity.before);
            if (!mongoose.isValidObjectId(target)) {
                return { ok: false, reason: "The original collection is unknown" };
            }

            const collection = await Collection.findById(target);
            if (!collection) {
                return { ok: false, reason: "The original collection no longer exists" };
            }

            record.collectionName = new mongoose.Types.ObjectId(target);
            await record.save();

            await logActivity({
                ...base,
                action: "record_moved",
                collectionName: target,
                before: activity.after,
                after: activity.before,
                message: `moved "${record.name}" back to ${collection.name}`
            });

            return { ok: true, message: "Record moved back" };
        }

        case "record_deleted": {
            const record = await RecordModel.findById(activity.record);
            if (!record) return { ok: false, reason: "That record no longer exists" };

            record.isArchived = false;
            await record.save();

            await logActivity({
                ...base,
                action: "record_updated",
                before: null,
                after: record.name,
                message: `restored record "${record.name}"`
            });

            return { ok: true, message: "Record restored" };
        }

        case "collection_updated": {
            const collection = await Collection.findById(activity.collectionName);
            if (!collection) return { ok: false, reason: "That collection no longer exists" };

            collection.name = asString(activity.before);
            await collection.save();

            await logActivity({
                ...base,
                action: "collection_updated",
                before: activity.after,
                after: activity.before,
                message: `reverted collection name back to "${collection.name}"`
            });

            return { ok: true, message: "Name reverted" };
        }

        case "column_updated": {
            const column = await Column.findById(activity.column);
            if (!column) return { ok: false, reason: "That column no longer exists" };

            column.name = asString(activity.before);
            await column.save();

            await logActivity({
                ...base,
                action: "column_updated",
                before: activity.after,
                after: activity.before,
                message: `reverted column name back to "${column.name}"`
            });

            return { ok: true, message: "Name reverted" };
        }

        default:
            return { ok: false, reason: "This kind of change cannot be reverted" };
    }
}

/** Stamps the original row so the button disappears and cannot fire twice. */
export async function markReverted(activityId: mongoose.Types.ObjectId, userId: string) {
    await Activity.findByIdAndUpdate(activityId, {
        revertedAt: new Date(),
        revertedBy: new mongoose.Types.ObjectId(userId)
    });
}
