import mongoose from "mongoose";
import Column from "../../models/Column";
import type { Id } from "./types";

/**
 * Column addressing.
 *
 * A module-scoped recipe stores a column id and this is a no-op. A
 * workspace-scoped one stores a NAME, because the same recipe has to run
 * against every board in the workspace and each board's "Status" is a
 * different document. Resolution happens per event, against the module the
 * event actually happened on.
 *
 * A name that no column on that module carries returns null. That is an
 * ordinary outcome for a workspace recipe — most boards will not have every
 * column the recipe mentions — so callers SKIP, they do not throw.
 */

export interface ColumnRef {
    column?: mongoose.Types.ObjectId | null;
    columnName?: string;
}

/**
 * One request's worth of name -> id lookups.
 *
 * A recipe with a trigger column, two conditions and two actions would
 * otherwise issue five near-identical queries per board, and a workspace
 * recipe pays that on every module it touches.
 */
export class ColumnResolver {
    private cache = new Map<string, mongoose.Types.ObjectId | null>();

    async resolve(
        ref: ColumnRef,
        moduleId: Id,
        scope: "record" | "subrecord" = "record"
    ): Promise<mongoose.Types.ObjectId | null> {
        if (ref.column) return new mongoose.Types.ObjectId(String(ref.column));

        const name = (ref.columnName ?? "").trim();
        if (!name) return null;

        const key = `${String(moduleId)}:${scope}:${name.toLowerCase()}`;
        if (this.cache.has(key)) return this.cache.get(key) ?? null;

        const found = await Column.findOne({
            module: moduleId,
            scope,
            // Anchored and escaped: a column called "C++ (est)" is a name, not
            // a pattern, and an unescaped one would either throw or match wildly.
            name: new RegExp(`^${escapeRegExp(name)}$`, "i")
        })
            .select("_id")
            .lean();

        const id = found ? new mongoose.Types.ObjectId(String(found._id)) : null;
        this.cache.set(key, id);
        return id;
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
