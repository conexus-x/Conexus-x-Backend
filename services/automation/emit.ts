import RecordModel from "../../models/Record";
import { runAutomations } from "./index";
import type { Id } from "./types";

/**
 * Emitters for the events a controller cannot describe in one line.
 *
 * Everything else is a plain `void runAutomations({ ... })` at the call site.
 * These two earn a helper because they involve a decision — "did this edit
 * finish the checklist?" — that would otherwise be copy-pasted into whichever
 * controllers happen to complete a sub-record.
 */

/**
 * Fires the right pair of column triggers for a cell write.
 *
 * A cell on a sub-record and a cell on a record are the same RecordValue row,
 * written through the same endpoint — the only thing that separates them is
 * the record's parentRecord. So the controller cannot know which of the four
 * column trigger types applies without asking, and firing all four would
 * double the hot path for a question one lookup answers.
 *
 * The engine loads the record again for its own subject guard. That is one
 * duplicated read on a path that only gets there when a recipe already
 * matched, and it keeps the guard in the one place that must never be bypassed.
 */
export async function emitColumnChange(input: {
    workspace: Id;
    module: Id;
    record: Id;
    column: Id;
    user: Id;
    before: unknown;
    after: unknown;
}): Promise<void> {
    try {
        const record = await RecordModel.findById(input.record)
            .select("parentRecord")
            .lean();

        if (!record) return;

        const sub = Boolean(record.parentRecord);

        await runAutomations({
            type: sub ? "subrecord_column_changed" : "column_changed",
            ...input
        });

        await runAutomations({
            type: sub ? "subrecord_column_changed_to" : "column_changed_to",
            ...input
        });
    } catch (error) {
        console.error("Column-change emit failed:", (error as Error).message);
    }
}

/**
 * Fires all_subrecords_completed on the PARENT if this was the last one.
 *
 * Two guards, both load-bearing:
 *
 *   - a record with no sub-records has not "completed them all", it never had
 *     any, so a count of zero must not fire;
 *   - the check runs against the database AFTER the write, not against what
 *     the caller thinks it just changed, so two people ticking the last two
 *     lines at once cannot both conclude they were last.
 *
 * Not awaited by callers: like every emit, this must never delay or fail the
 * user's write.
 */
export async function emitIfChecklistFinished(input: {
    parentRecordId: Id;
    workspace: Id;
    module: Id;
    user: Id;
}): Promise<void> {
    try {
        const parent = await RecordModel.findById(input.parentRecordId)
            .select("_id isArchived")
            .lean();

        if (!parent || parent.isArchived) return;

        const total = await RecordModel.countDocuments({
            parentRecord: input.parentRecordId,
            isArchived: false
        });

        if (total === 0) return;

        const outstanding = await RecordModel.countDocuments({
            parentRecord: input.parentRecordId,
            isArchived: false,
            isCompleted: false
        });

        if (outstanding > 0) return;

        await runAutomations({
            type: "all_subrecords_completed",
            workspace: input.workspace,
            module: input.module,
            record: input.parentRecordId,
            user: input.user,
            after: String(total)
        });
    } catch (error) {
        console.error(
            "Checklist-finished check failed:",
            (error as Error).message
        );
    }
}
