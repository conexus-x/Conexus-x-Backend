import mongoose from "mongoose";
import Column from "../models/Column";

/**
 * The columns a module's sub-records are shown with, seeded the first time one
 * is created.
 *
 * An empty sub-record grid is just a list of names, so the first sub-record on
 * a module arrives with somewhere to put its work. These are deliberately NOT
 * the parent's columns — a sub-record answers different questions than the row
 * above it, which is the whole point of giving it its own scope.
 *
 * Lives here rather than in record.controller because the automation engine
 * creates sub-records too (the create_subrecord action), and a second copy of
 * this list would drift the moment either side gained a column.
 */
export const DEFAULT_SUB_COLUMNS = [
    { name: "Owner", type: "person" },
    { name: "Status", type: "status" },
    { name: "Due date", type: "date" }
];

export const seedSubColumns = async (
    moduleId: mongoose.Types.ObjectId | string,
    userId: string
) => {
    const existing = await Column.countDocuments({
        module: moduleId,
        scope: "subrecord"
    });

    if (existing > 0) return;

    await Column.insertMany(
        DEFAULT_SUB_COLUMNS.map((column, index) => ({
            module: moduleId,
            scope: "subrecord",
            name: column.name,
            type: column.type,
            statusOptions:
                column.type === "status"
                    ? [
                        { label: "Not Started", color: "#94A3B8" },
                        { label: "Working on it", color: "#F59E0B" },
                        { label: "Stuck", color: "#EF4444" },
                        { label: "Done", color: "#22C55E" }
                    ]
                    : undefined,
            position: index,
            createdBy: new mongoose.Types.ObjectId(userId)
        }))
    );
};
