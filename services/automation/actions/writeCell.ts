import mongoose from "mongoose";
import Column from "../../../models/Column";
import RecordValue from "../../../models/RecordValue";
import type { IRecord } from "../../../models/Record";
import { same } from "../values";
import type { ActionContext } from "../types";

/**
 * Writes one cell, whether it already exists or not, and logs it.
 *
 * Shared by set_column_value, clear_column_value and set_parent_column_value —
 * the only difference between those three is which record and which value, so
 * the upsert-and-log lives once here.
 *
 * Returns false when the cell already held that value: an automation that
 * "ran" without changing anything should not appear in the run feed, and more
 * importantly should not log a cell_updated with before === after.
 */
export async function writeCell(
    ctx: ActionContext,
    target: IRecord,
    columnId: mongoose.Types.ObjectId,
    value: string
): Promise<boolean> {
    const existing = await RecordValue.findOne({
        record: target._id,
        column: columnId
    });

    const before = existing?.value ?? null;
    if (same(before, value)) return false;

    if (existing) {
        existing.value = value;
        await existing.save();
    } else {
        await RecordValue.create({
            workspace: target.workspace,
            module: target.module,
            collectionName: target.collectionName,
            record: target._id,
            column: columnId,
            value,
            createdBy: ctx.event.user
        });
    }

    // Named rather than "a field": the run feed is read by whoever is trying to
    // work out why their board changed under them.
    const column = await Column.findById(columnId).select("name").lean();
    const columnName = column?.name || "a field";

    await ctx.log({
        action: "cell_updated",
        module: target.module,
        collectionName: target.collectionName,
        record: target._id,
        column: columnId,
        targetName: target.name,
        before,
        after: value,
        message: value
            ? `set ${columnName} on "${target.name}" to "${value}"`
            : `cleared ${columnName} on "${target.name}"`
    });

    return true;
}
