import mongoose from "mongoose";
import RecordModel from "../../../models/Record";
import { same, str } from "../values";
import { writeCell } from "./writeCell";
import type { ActionContext, ActionHandler } from "../types";

/**
 * Actions that reach UP from a sub-record to its parent.
 *
 * These are the other half of the checklist pattern: a sub-record trigger fires
 * on the child, and the useful consequence is almost always on the row above it
 * ("when a checklist line is blocked, flag the record"). Without them a
 * sub-record trigger could only ever edit the sub-record itself.
 *
 * Each one loads the parent and returns false if there is not one — a recipe
 * that pairs a record trigger with a parent action is mis-assembled, and doing
 * nothing is the correct outcome.
 */

/** The parent of the record the trigger fired on, or null. */
async function parentOf(ctx: ActionContext) {
    if (!ctx.record.parentRecord) return null;
    return RecordModel.findById(ctx.record.parentRecord);
}

const setParentColumnValue: ActionHandler = async (ctx) => {
    const parent = await parentOf(ctx);
    if (!parent) return false;

    // A record-scope column: the parent is on the board, not in the sub-grid.
    const columnId = await ctx.column(parent.module, "record");
    if (!columnId) return false;

    return writeCell(ctx, parent, columnId, ctx.fill(ctx.action.value));
};

const setParentCompleted: ActionHandler = async (ctx) => {
    const parent = await parentOf(ctx);
    if (!parent) return false;

    const next = str(ctx.action.value).toLowerCase() !== "false";
    if (parent.isCompleted === next) return false;

    parent.isCompleted = next;
    await parent.save();

    await ctx.log({
        action: "record_updated",
        module: parent.module,
        collectionName: parent.collectionName,
        record: parent._id,
        targetName: parent.name,
        before: String(!next),
        after: String(next),
        message: `marked "${parent.name}" ${next ? "complete" : "incomplete"}`
    });

    return true;
};

const moveParentToCollection: ActionHandler = async (ctx) => {
    const target = ctx.action.collectionName;
    if (!target) return false;

    const parent = await parentOf(ctx);
    if (!parent) return false;
    if (same(parent.collectionName, target)) return false;

    const before = String(parent.collectionName);
    parent.collectionName = new mongoose.Types.ObjectId(String(target));
    await parent.save();

    /**
     * A sub-record inherits its parent's collection so that every
     * module/collection-scoped query keeps working — so moving the parent has
     * to take the children with it, or the board's own filters start
     * disagreeing about where those rows live.
     */
    await RecordModel.updateMany(
        { parentRecord: parent._id },
        { collectionName: parent.collectionName }
    );

    await ctx.log({
        action: "record_moved",
        module: parent.module,
        collectionName: target,
        record: parent._id,
        targetName: parent.name,
        before,
        after: String(target),
        message: `moved "${parent.name}" to another collection`
    });

    return true;
};

export const parentActions: Record<string, ActionHandler> = {
    set_parent_column_value: setParentColumnValue,
    set_parent_completed: setParentCompleted,
    move_parent_to_collection: moveParentToCollection
};
