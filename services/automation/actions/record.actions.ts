import mongoose from "mongoose";
import RecordModel from "../../../models/Record";
import { same, str } from "../values";
import { writeCell } from "./writeCell";
import type { ActionContext, ActionHandler } from "../types";

/**
 * Actions that change the record the trigger fired on.
 *
 * Every one of them returns false when the record is already in the requested
 * state. That is not an optimisation — it is what keeps the run feed honest,
 * and it is the reason a recipe pointed at its own trigger column settles
 * instead of looping (the engine also never re-enters itself, see index.ts).
 */

const setColumnValue: ActionHandler = async (ctx) => {
    const columnId = await ctx.column(ctx.record.module);
    if (!columnId) return false;

    return writeCell(ctx, ctx.record, columnId, ctx.fill(ctx.action.value));
};

const clearColumnValue: ActionHandler = async (ctx) => {
    const columnId = await ctx.column(ctx.record.module);
    if (!columnId) return false;

    return writeCell(ctx, ctx.record, columnId, "");
};

const moveToCollection: ActionHandler = async (ctx) => {
    const target = ctx.action.collectionName;
    if (!target) return false;

    const record = await RecordModel.findById(ctx.record._id);
    if (!record) return false;
    if (same(record.collectionName, target)) return false;

    const before = String(record.collectionName);
    record.collectionName = new mongoose.Types.ObjectId(String(target));
    await record.save();

    await ctx.log({
        action: "record_moved",
        module: record.module,
        collectionName: target,
        record: record._id,
        targetName: record.name,
        before,
        after: String(target),
        message: `moved "${record.name}" to another collection`
    });

    return true;
};

const archiveRecord: ActionHandler = async (ctx) => {
    const record = await RecordModel.findById(ctx.record._id);
    if (!record || record.isArchived) return false;

    record.isArchived = true;
    await record.save();

    /**
     * Archiving a parent takes its sub-records with it, exactly as
     * deleteRecord does — they are only reachable through the row that just
     * disappeared, so leaving them behind creates rows nothing can show or
     * remove again.
     */
    if (!record.parentRecord) {
        await RecordModel.updateMany(
            { parentRecord: record._id, isArchived: false },
            { isArchived: true }
        );
    }

    await ctx.log({
        action: "record_deleted",
        module: record.module,
        collectionName: record.collectionName,
        record: record._id,
        targetName: record.name,
        before: record.name,
        after: null,
        message: `archived "${record.name}"`
    });

    return true;
};

const setCompleted: ActionHandler = async (ctx) => {
    const record = await RecordModel.findById(ctx.record._id);
    if (!record) return false;

    const next = str(ctx.action.value).toLowerCase() !== "false";
    if (record.isCompleted === next) return false;

    record.isCompleted = next;
    await record.save();

    await ctx.log({
        action: "record_updated",
        module: record.module,
        collectionName: record.collectionName,
        record: record._id,
        targetName: record.name,
        before: String(!next),
        after: String(next),
        message: `marked "${record.name}" ${next ? "complete" : "incomplete"}`
    });

    return true;
};

const renameRecord: ActionHandler = async (ctx) => {
    const next = ctx.fill(ctx.action.value).trim().slice(0, 200);
    if (!next) return false;

    const record = await RecordModel.findById(ctx.record._id);
    if (!record || record.name === next) return false;

    const before = record.name;
    record.name = next;
    await record.save();

    await ctx.log({
        action: "record_updated",
        module: record.module,
        collectionName: record.collectionName,
        record: record._id,
        targetName: next,
        before,
        after: next,
        message: `renamed "${before}" to "${next}"`
    });

    return true;
};

export const recordActions: Record<string, ActionHandler> = {
    set_column_value: setColumnValue,
    clear_column_value: clearColumnValue,
    move_to_collection: moveToCollection,
    archive_record: archiveRecord,
    set_completed: setCompleted,
    rename_record: renameRecord
};

export type { ActionContext };
