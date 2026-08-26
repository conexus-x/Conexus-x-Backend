import mongoose from "mongoose";
import Workspace from "../models/Workspace";
import Module from "../models/Module";

/**
 * Updates the `updatedAt` timestamp of a workspace whenever any entity inside it 
 * (module, collection, record, column, record value, member) is created, updated, or deleted.
 */
export async function touchWorkspace(workspaceId: string | mongoose.Types.ObjectId | undefined | null) {
    if (!workspaceId) return;
    try {
        await Workspace.findByIdAndUpdate(workspaceId, { updatedAt: new Date() });
    } catch (err) {
        console.error("Error updating workspace updatedAt:", err);
    }
}

/**
 * Same idea one level down: a module's `updatedAt` should mean "when did
 * anything in here last change", not "when was the module row itself edited".
 *
 * WHY THIS EXISTS. Mongoose timestamps only move when the Module DOCUMENT is
 * written, so editing a record, a cell, a collection or a column left the
 * module reading as untouched — a workspace could show "Customers · 1d ago"
 * moments after someone renamed a record inside it. touchWorkspace had the same
 * job at the workspace level and was already called from all those paths; this
 * is its counterpart, and the two are called together.
 *
 * updateOne, not findByIdAndUpdate: nothing here needs the document back, and
 * this runs on the hot path of every cell write.
 */
export async function touchModule(
    moduleId: string | mongoose.Types.ObjectId | undefined | null
) {
    if (!moduleId) return;
    try {
        await Module.updateOne({ _id: moduleId }, { updatedAt: new Date() });
    } catch (err) {
        console.error("Error updating module updatedAt:", err);
    }
}
