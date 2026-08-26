import mongoose from "mongoose";
import RecordModel from "../../../models/Record";
import { seedSubColumns } from "../../../utils/subColumns";
import type { ActionHandler } from "../types";

/**
 * Actions that reach DOWN from a record to its sub-records.
 *
 * All three refuse to run on a sub-record: one level of nesting is the
 * contract (see createSubRecord), so "add a sub-record" fired from a
 * sub-record trigger has nowhere to put the row. Refusing is quiet and
 * returns false rather than throwing — a recipe someone mis-assembled should
 * show as "did nothing", not as a red error on the card forever.
 */

const createSubRecord: ActionHandler = async (ctx) => {
    if (ctx.record.parentRecord) return false;

    const name = ctx.fill(ctx.action.value).trim().slice(0, 200);
    if (!name) return false;

    // The board's sub-grid is a list of names until it has columns, and this
    // may well be the module's first sub-record.
    await seedSubColumns(ctx.record.module, String(ctx.event.user));

    const last = await RecordModel.findOne({ parentRecord: ctx.record._id }).sort({
        position: -1
    });

    const created = await RecordModel.create({
        workspace: ctx.record.workspace,
        module: ctx.record.module,
        // Inherited, so every module/collection-scoped query keeps working.
        collectionName: ctx.record.collectionName,
        parentRecord: ctx.record._id,
        name,
        position: last ? last.position + 1 : 0,
        createdBy: new mongoose.Types.ObjectId(String(ctx.event.user))
    });

    await ctx.log({
        action: "record_created",
        module: ctx.record.module,
        collectionName: ctx.record.collectionName,
        record: created._id,
        targetName: name,
        after: name,
        message: `added sub-record "${name}" under "${ctx.record.name}"`
    });

    return true;
};

const completeAllSubRecords: ActionHandler = async (ctx) => {
    if (ctx.record.parentRecord) return false;

    const result = await RecordModel.updateMany(
        { parentRecord: ctx.record._id, isArchived: false, isCompleted: false },
        { isCompleted: true }
    );

    if (result.modifiedCount === 0) return false;

    await ctx.log({
        action: "record_updated",
        module: ctx.record.module,
        collectionName: ctx.record.collectionName,
        record: ctx.record._id,
        targetName: ctx.record.name,
        before: "false",
        after: "true",
        message: `marked ${result.modifiedCount} sub-record${result.modifiedCount === 1 ? "" : "s"} of "${ctx.record.name}" complete`
    });

    return true;
};

const archiveAllSubRecords: ActionHandler = async (ctx) => {
    if (ctx.record.parentRecord) return false;

    const result = await RecordModel.updateMany(
        { parentRecord: ctx.record._id, isArchived: false },
        { isArchived: true }
    );

    if (result.modifiedCount === 0) return false;

    await ctx.log({
        action: "record_deleted",
        module: ctx.record.module,
        collectionName: ctx.record.collectionName,
        record: ctx.record._id,
        targetName: ctx.record.name,
        before: String(result.modifiedCount),
        after: null,
        message: `archived ${result.modifiedCount} sub-record${result.modifiedCount === 1 ? "" : "s"} of "${ctx.record.name}"`
    });

    return true;
};

export const subRecordActions: Record<string, ActionHandler> = {
    create_subrecord: createSubRecord,
    complete_all_subrecords: completeAllSubRecords,
    archive_all_subrecords: archiveAllSubRecords
};
