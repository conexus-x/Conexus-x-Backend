import mongoose, { Document, Model, Schema } from "mongoose";

/**
 * An automation recipe: trigger + optional conditions + actions.
 *
 * SCOPE. A recipe is either pinned to one module, or scoped to the whole
 * workspace and evaluated against every module in it. That difference is the
 * reason columns are addressable two ways:
 *
 *   - `column`     an ObjectId. Exact, and only meaningful inside one module.
 *   - `columnName` a string. Resolved to a column of that name in whichever
 *                  module the event happened in.
 *
 * A workspace recipe cannot use `column` — the id would only ever match the one
 * board it came from, which is the thing the user was trying not to do. It uses
 * `columnName` and matches "Status" wherever a board has a Status column. The
 * controller enforces this; the engine assumes it.
 *
 * SUBJECT. Every trigger is about either a record or a sub-record, never both.
 * "When a record is created" must not fire on a checklist line, and "when a
 * sub-record is completed" must not fire on the parent row. See subjectOf() in
 * services/automation/triggers.ts — the engine drops any event whose subject
 * does not match its trigger's.
 */

/* ------------------------------------------------------------------ *
 * Triggers
 * ------------------------------------------------------------------ */

export const TRIGGER_TYPES = [
    /* --- record lifecycle --- */
    /** A record was added to a collection in this module. */
    "record_created",
    /** A record was moved between collections. */
    "record_moved",
    /** A record's name changed. */
    "record_renamed",
    /** A record was ticked complete. */
    "record_completed",
    /** A completed record was un-ticked. */
    "record_uncompleted",
    /** A record was archived (the soft delete the UI performs). */
    "record_archived",

    /* --- cells --- */
    /** Any change to a specific column's value. */
    "column_changed",
    /** A specific column changed *to* a specific value (status workflows). */
    "column_changed_to",

    /* --- sub-records --- */
    /** A sub-record was added under a record. */
    "subrecord_created",
    /** Any change to a sub-record column's value. */
    "subrecord_column_changed",
    /** A sub-record column changed *to* a specific value. */
    "subrecord_column_changed_to",
    /** A sub-record was ticked complete. */
    "subrecord_completed",
    /**
     * The last outstanding sub-record of a record was completed. Fires on the
     * PARENT, not the child — the classic "all the checklist is done, close the
     * record" recipe. Never fires for a record with no sub-records at all.
     */
    "all_subrecords_completed",

    /* --- conversation --- */
    /** Someone posted an amendment on a record. */
    "amendment_posted"
] as const;

/* ------------------------------------------------------------------ *
 * Conditions
 * ------------------------------------------------------------------ */

export const CONDITION_OPS = [
    "is",
    "is_not",
    "is_empty",
    "is_not_empty",
    "contains",
    "not_contains",
    "starts_with",
    "greater_than",
    "less_than"
] as const;

/** Where a condition reads its actual value from. */
export const CONDITION_SOURCES = ["column", "record"] as const;

/**
 * Record-level fields a condition can test, for the cases a column cannot
 * express — "only if it is still in Backlog", "only if it has no sub-records".
 */
export const RECORD_FIELDS = [
    "name",
    "collection",
    "is_completed",
    "is_archived",
    "subrecord_count",
    "amendment_count"
] as const;

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export const ACTION_TYPES = [
    /* --- this record --- */
    /** Write a value into another column on the same record. */
    "set_column_value",
    /** Blank a column on the same record. */
    "clear_column_value",
    /** Move the record into a different collection. */
    "move_to_collection",
    /** Archive the record (the same soft delete the UI performs). */
    "archive_record",
    /** Flip the record's completion flag. */
    "set_completed",
    /** Rename the record. Supports the {record} / {value} placeholders. */
    "rename_record",

    /* --- sub-records --- */
    /** Add a sub-record under this record. */
    "create_subrecord",
    /** Tick every sub-record of this record complete. */
    "complete_all_subrecords",
    /** Archive every sub-record of this record. */
    "archive_all_subrecords",

    /* --- the parent, from a sub-record trigger --- */
    /** Write a value into a column on this sub-record's PARENT. */
    "set_parent_column_value",
    /** Tick the parent complete / incomplete. */
    "set_parent_completed",
    /** Move the parent into a different collection. */
    "move_parent_to_collection",

    /* --- elsewhere --- */
    /** Create a record in a collection, on this module or another one. */
    "create_record",

    /* --- conversation --- */
    /** Post an amendment on the record. */
    "post_amendment"
] as const;

export type TriggerType = (typeof TRIGGER_TYPES)[number];
export type ConditionOp = (typeof CONDITION_OPS)[number];
export type ConditionSource = (typeof CONDITION_SOURCES)[number];
export type RecordField = (typeof RECORD_FIELDS)[number];
export type ActionType = (typeof ACTION_TYPES)[number];
export type AutomationScope = "module" | "workspace";
export type MatchMode = "all" | "any";

export interface IAutomationCondition {
    /** "column" reads a cell; "record" reads a field on the record itself. */
    source: ConditionSource;
    /** Module-scoped recipes address the column by id. */
    column?: mongoose.Types.ObjectId;
    /** Workspace-scoped recipes address it by name instead. */
    columnName?: string;
    /** Which record field, when source is "record". */
    field?: RecordField;
    op: ConditionOp;
    value?: string;
}

export interface IAutomationAction {
    type: ActionType;
    /** Target column for set_column_value / clear_column_value / parent writes. */
    column?: mongoose.Types.ObjectId;
    /** Same, addressed by name, for workspace-scoped recipes. */
    columnName?: string;
    /** Target collection for move_to_collection / move_parent_to_collection. */
    collectionName?: mongoose.Types.ObjectId;
    /** Where create_record puts the new row. Module defaults to the event's. */
    targetModule?: mongoose.Types.ObjectId;
    targetCollection?: mongoose.Types.ObjectId;
    /**
     * The value to write, "true"/"false" for the completion actions, or the
     * name / message for the actions that create something.
     */
    value?: string;
}

export interface IAutomation extends Document {
    workspace: mongoose.Types.ObjectId;

    /**
     * The board this recipe watches. Null for a workspace-scoped recipe, which
     * watches every board in the workspace.
     */
    module: mongoose.Types.ObjectId | null;

    scope: AutomationScope;

    name: string;

    trigger: {
        type: TriggerType;
        /** Watched column, for the column_changed* triggers. */
        column?: mongoose.Types.ObjectId;
        /** The same column addressed by name, for workspace scope. */
        columnName?: string;
        /** The value that arms column_changed_to. */
        value?: string;
    };

    conditions: IAutomationCondition[];
    /** Whether every condition must hold, or just one of them. */
    match: MatchMode;

    actions: IAutomationAction[];

    isActive: boolean;

    /** Observability — how often it fired and whether the last run failed. */
    runCount: number;
    lastRunAt?: Date;
    lastError?: string;

    createdBy: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const AutomationSchema = new Schema<IAutomation>(
    {
        workspace: {
            type: Schema.Types.ObjectId,
            ref: "Workspace",
            required: true,
            index: true
        },

        module: {
            type: Schema.Types.ObjectId,
            ref: "Module",
            // Null is a real value here (workspace scope), not a missing one.
            default: null,
            index: true
        },

        scope: {
            type: String,
            enum: ["module", "workspace"],
            default: "module",
            index: true
        },

        name: {
            type: String,
            required: true,
            trim: true
        },

        trigger: {
            type: {
                type: String,
                enum: TRIGGER_TYPES,
                required: true
            },
            column: {
                type: Schema.Types.ObjectId,
                ref: "Column"
            },
            columnName: {
                type: String,
                trim: true,
                default: ""
            },
            value: {
                type: String,
                default: ""
            }
        },

        conditions: [
            {
                _id: false,
                source: {
                    type: String,
                    enum: CONDITION_SOURCES,
                    default: "column"
                },
                column: {
                    type: Schema.Types.ObjectId,
                    ref: "Column"
                },
                columnName: {
                    type: String,
                    trim: true,
                    default: ""
                },
                field: {
                    type: String,
                    enum: RECORD_FIELDS
                },
                op: {
                    type: String,
                    enum: CONDITION_OPS,
                    required: true
                },
                value: {
                    type: String,
                    default: ""
                }
            }
        ],

        match: {
            type: String,
            enum: ["all", "any"],
            default: "all"
        },

        actions: [
            {
                _id: false,
                type: {
                    type: String,
                    enum: ACTION_TYPES,
                    required: true
                },
                column: {
                    type: Schema.Types.ObjectId,
                    ref: "Column"
                },
                columnName: {
                    type: String,
                    trim: true,
                    default: ""
                },
                collectionName: {
                    type: Schema.Types.ObjectId,
                    ref: "Collection"
                },
                targetModule: {
                    type: Schema.Types.ObjectId,
                    ref: "Module"
                },
                targetCollection: {
                    type: Schema.Types.ObjectId,
                    ref: "Collection"
                },
                value: {
                    type: String,
                    default: ""
                }
            }
        ],

        isActive: {
            type: Boolean,
            default: true
        },

        runCount: {
            type: Number,
            default: 0
        },

        lastRunAt: {
            type: Date,
            default: null
        },

        lastError: {
            type: String,
            default: ""
        },

        createdBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    },
    { timestamps: true }
);

// The engine's hot path: find active recipes for a module by trigger type.
AutomationSchema.index({ module: 1, isActive: 1, "trigger.type": 1 });

// The other half of that lookup — workspace recipes have no module to key on.
AutomationSchema.index({ workspace: 1, scope: 1, isActive: 1, "trigger.type": 1 });

const Automation: Model<IAutomation> =
    mongoose.models.Automation ||
    mongoose.model<IAutomation>("Automation", AutomationSchema);

export default Automation;
