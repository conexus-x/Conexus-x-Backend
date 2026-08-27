import mongoose from "mongoose";
import Activity, { type ActivityAction } from "../models/Activity";
import { emitChange } from "./realtime.service";

/**
 * Writes the audit trail. Every mutation controller calls logActivity() after
 * the write succeeds.
 *
 * Logging is best-effort by design: a failure here is swallowed and logged
 * server-side, never surfaced to the caller. Losing an audit row is bad; failing
 * the user's actual edit because the audit row could not be written is worse.
 */

type Id = mongoose.Types.ObjectId | string | undefined | null;

export interface LogActivityInput {
    workspace: Id;
    user: Id;
    action: ActivityAction;
    message: string;

    module?: Id;
    collectionName?: Id;
    record?: Id;
    column?: Id;

    /** Name of the thing at the time of the change — outlives a delete. */
    targetName?: string;

    /** The from → to pair. Omit both for actions that have no prior state. */
    before?: unknown;
    after?: unknown;

    metadata?: Record<string, unknown>;
}

const toId = (value: Id): mongoose.Types.ObjectId | undefined => {
    if (!value) return undefined;
    return mongoose.isValidObjectId(value)
        ? new mongoose.Types.ObjectId(String(value))
        : undefined;
};

/** Cell values can be long; the feed only ever renders a preview. */
const MAX_VALUE_CHARS = 500;

const trim = (value: unknown): unknown => {
    if (value === undefined) return null;
    if (typeof value === "string" && value.length > MAX_VALUE_CHARS) {
        return `${value.slice(0, MAX_VALUE_CHARS)}…`;
    }
    return value;
};

export async function logActivity(input: LogActivityInput): Promise<void> {
    const workspace = toId(input.workspace);
    const user = toId(input.user);

    // Both are required by the schema — without them the row is unattributable.
    if (!workspace || !user) return;

    try {
        const row = await Activity.create({
            workspace,
            user,
            action: input.action,
            message: input.message,
            module: toId(input.module),
            collectionName: toId(input.collectionName),
            record: toId(input.record),
            column: toId(input.column),
            targetName: input.targetName ?? "",
            before: trim(input.before),
            after: trim(input.after),
            metadata: input.metadata ?? {}
        });

        /**
         * The feed goes realtime from HERE rather than from twenty controllers.
         * Every mutation already funnels through this function, so one emit
         * covers the whole audit trail and a controller added tomorrow is live
         * without anyone remembering to wire it.
         *
         * NO originId, deliberately: unlike a cell edit, the actor's client
         * never wrote this row optimistically — the server invented it — so the
         * person who caused it needs the echo as much as everybody else. This
         * is also what retires the 10s automation-runs poll: an automated
         * change is an activity row stamped metadata.automation, and it now
         * arrives instead of being discovered.
         */
        emitChange({
            entity: "activity",
            action: "created",
            id: String(row._id),
            workspaceId: String(workspace),
            moduleId: input.module ? String(input.module) : undefined,
            recordId: input.record ? String(input.record) : undefined,
            actorId: String(user),
            data: row
        });
    } catch (error) {
        console.error("Activity log failed:", (error as Error).message);
    }
}

/** Renders a value for the `message` one-liner. */
export function describeValue(value: unknown): string {
    if (value === null || value === undefined || value === "") return "empty";

    if (typeof value === "string") {
        return value.length > 60 ? `"${value.slice(0, 60)}…"` : `"${value}"`;
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    return "a new value";
}
