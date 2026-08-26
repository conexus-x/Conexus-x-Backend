import mongoose from "mongoose";
import type {
    IAutomation,
    IAutomationAction,
    TriggerType
} from "../../models/Automation";
import type { IRecord } from "../../models/Record";

export type Id = mongoose.Types.ObjectId | string;

/**
 * What a controller reports after a successful write.
 *
 * `module` is always the module the thing happened on — never the recipe's,
 * which for a workspace-scoped recipe is null. Every column lookup and every
 * action resolves against this module, so a workspace recipe running on five
 * boards writes to the right board's columns each time.
 */
export interface AutomationEvent {
    type: TriggerType;
    workspace: Id;
    module: Id;
    record: Id;
    /** The user whose action produced the event. Automated changes are logged
     *  against them, so the audit trail stays truthful. */
    user: Id;

    /** For the column_changed* triggers, on records and sub-records alike. */
    column?: Id;
    before?: unknown;
    after?: unknown;

    /** For record_moved. */
    collectionName?: Id;

    /** For amendment_posted — the text that was posted. */
    text?: string;
}

/**
 * Everything one action handler needs, assembled once per run.
 *
 * Handlers are deliberately given helpers rather than raw ids: `column()` hides
 * the id-or-name addressing that module and workspace scope differ on, and
 * `log()` arrives pre-stamped with metadata.automation, which is the only thing
 * that makes a change show up in the run feed.
 */
export interface ActionContext {
    automation: IAutomation;
    event: AutomationEvent;
    action: IAutomationAction;

    /** The record the trigger is about. Already fetched — do not re-read it. */
    record: IRecord;

    /**
     * Resolves this action's column against a module, by id or by name.
     * Returns null when the recipe names a column that module does not have,
     * which is normal for a workspace recipe and must be skipped, not thrown.
     */
    column(moduleId: Id, scope?: "record" | "subrecord"): Promise<mongoose.Types.ObjectId | null>;

    /** Substitutes {record} and {value} into an action's text. */
    fill(template?: string): string;

    /** Writes an activity row attributed to the triggering user. */
    log(entry: AutomationLogEntry): Promise<void>;
}

export interface AutomationLogEntry {
    action:
    | "record_created"
    | "record_updated"
    | "record_moved"
    | "record_deleted"
    | "cell_updated"
    | "comment_added";
    /** Without the `automation "name"` prefix — log() adds it. */
    message: string;
    module?: Id;
    collectionName?: Id;
    record?: Id;
    column?: Id;
    targetName?: string;
    before?: unknown;
    after?: unknown;
}

/** Returns true when it actually changed something. */
export type ActionHandler = (ctx: ActionContext) => Promise<boolean>;

export type { IAutomation, IAutomationAction, TriggerType };
