import mongoose from "mongoose";
import Workspace from "../models/Workspace";

/**
 * Updates the `updatedAt` timestamp of a workspace whenever any entity inside it 
 * (board, group, item, column, item value, member) is created, updated, or deleted.
 */
export async function touchWorkspace(workspaceId: string | mongoose.Types.ObjectId | undefined | null) {
    if (!workspaceId) return;
    try {
        await Workspace.findByIdAndUpdate(workspaceId, { updatedAt: new Date() });
    } catch (err) {
        console.error("Error updating workspace updatedAt:", err);
    }
}
