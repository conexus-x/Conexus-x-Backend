import mongoose from "mongoose";
import {
    ACTION_TYPES,
    CONDITION_OPS,
    CONDITION_SOURCES,
    RECORD_FIELDS,
    TRIGGER_TYPES,
    type ActionType,
    type AutomationScope,
    type ConditionOp,
    type ConditionSource,
    type MatchMode,
    type RecordField,
    type TriggerType
} from "../../models/Automation";

/**
 * Turning a request body into a recipe the engine can execute.
 *
 * Sanitising and validating are separate on purpose and must stay in that
 * order: sanitise casts strings into the enum types (which is only honest
 * because validate rejects anything outside them straight after), and validate
 * answers the harder question of whether the parts fit together — a
 * column_changed_to with no value, a workspace recipe pointed at one board's
 * collection, an action whose target was never chosen.
 *
 * The client mirrors these requirements to grey out its Save button, but the
 * server owns them: every message here is shown to the user verbatim.
 */

const oid = (value: unknown): mongoose.Types.ObjectId | undefined =>
    value && mongoose.isValidObjectId(String(value))
        ? new mongoose.Types.ObjectId(String(value))
        : undefined;

const text = (value: unknown): string => String(value ?? "").trim();

export interface SanitisedRecipe {
    name: string;
    scope: AutomationScope;
    match: MatchMode;
    trigger: {
        type: TriggerType;
        column?: mongoose.Types.ObjectId;
        columnName: string;
        value: string;
    };
    conditions: {
        source: ConditionSource;
        column?: mongoose.Types.ObjectId;
        columnName: string;
        field?: RecordField;
        op: ConditionOp;
        value: string;
    }[];
    actions: {
        type: ActionType;
        column?: mongoose.Types.ObjectId;
        columnName: string;
        collectionName?: mongoose.Types.ObjectId;
        targetModule?: mongoose.Types.ObjectId;
        targetCollection?: mongoose.Types.ObjectId;
        value: string;
    }[];
}

/** Strips anything the client should not be able to set directly. */
export function sanitiseRecipe(
    body: Record<string, unknown>,
    scope: AutomationScope
): SanitisedRecipe {
    const trigger = (body.trigger ?? {}) as Record<string, unknown>;

    const conditions = Array.isArray(body.conditions) ? body.conditions : [];
    const actions = Array.isArray(body.actions) ? body.actions : [];

    return {
        name: text(body.name),
        scope,
        match: body.match === "any" ? "any" : "all",

        trigger: {
            type: text(trigger.type) as TriggerType,
            column: oid(trigger.column),
            columnName: text(trigger.columnName),
            value: String(trigger.value ?? "")
        },

        conditions: conditions
            .filter((c): c is Record<string, unknown> => Boolean(c))
            .map((c) => ({
                source: (c.source === "record" ? "record" : "column") as ConditionSource,
                column: oid(c.column),
                columnName: text(c.columnName),
                field: RECORD_FIELDS.includes(String(c.field) as RecordField)
                    ? (String(c.field) as RecordField)
                    : undefined,
                op: text(c.op ?? "is") as ConditionOp,
                value: String(c.value ?? "")
            }))
            // A condition that names neither a column nor a field cannot be
            // evaluated; dropping it is kinder than failing the whole save on
            // a row the user half-filled and then ignored.
            .filter((c) =>
                c.source === "record" ? Boolean(c.field) : Boolean(c.column || c.columnName)
            ),

        actions: actions
            .filter((a): a is Record<string, unknown> => Boolean(a))
            .map((a) => ({
                type: text(a.type) as ActionType,
                column: oid(a.column),
                columnName: text(a.columnName),
                collectionName: oid(a.collectionName),
                targetModule: oid(a.targetModule),
                targetCollection: oid(a.targetCollection),
                value: String(a.value ?? "")
            }))
    };
}

/* ------------------------------------------------------------------ *
 * What each part requires
 * ------------------------------------------------------------------ */

/** Triggers that watch a named column. */
const COLUMN_TRIGGERS: TriggerType[] = [
    "column_changed",
    "column_changed_to",
    "subrecord_column_changed",
    "subrecord_column_changed_to"
];

/** Triggers that also need the value that arms them. */
const VALUE_TRIGGERS: TriggerType[] = [
    "column_changed_to",
    "subrecord_column_changed_to"
];

/** Actions that write to a column. */
const COLUMN_ACTIONS: ActionType[] = [
    "set_column_value",
    "clear_column_value",
    "set_parent_column_value"
];

/** Actions that move a record into a specific collection. */
const COLLECTION_ACTIONS: ActionType[] = [
    "move_to_collection",
    "move_parent_to_collection"
];

/** Actions whose `value` is the text they write, and which do nothing without it. */
const TEXT_ACTIONS: ActionType[] = [
    "set_column_value",
    "rename_record",
    "create_subrecord",
    "create_record",
    "post_amendment",
    "set_parent_column_value"
];

/** Labels used only in error messages, so they read as the UI does. */
const ACTION_LABELS: Partial<Record<ActionType, string>> = {
    rename_record: "the new name",
    create_subrecord: "the sub-record's name",
    create_record: "the new record's name",
    post_amendment: "the message to post",
    set_column_value: "the value to write",
    set_parent_column_value: "the value to write"
};

/** Rejects recipes the engine could not actually execute. */
export function validateRecipe(recipe: SanitisedRecipe): string | null {
    if (!recipe.name) return "Give the automation a name";

    if (!(TRIGGER_TYPES as readonly string[]).includes(recipe.trigger.type)) {
        return "Choose a trigger";
    }

    const workspaceScoped = recipe.scope === "workspace";

    /**
     * The scope rule, and the reason columnName exists at all. A workspace
     * recipe runs on every module, and a column id only exists on one of them —
     * so an id here would silently narrow the recipe back to a single board,
     * which is exactly what the user chose workspace scope to avoid.
     */
    if (workspaceScoped && recipe.trigger.column) {
        return "A workspace automation matches columns by name, not from one module";
    }

    if (COLUMN_TRIGGERS.includes(recipe.trigger.type)) {
        const named = workspaceScoped ? recipe.trigger.columnName : recipe.trigger.column;
        if (!named) return "Choose the column the trigger watches";
    }

    if (VALUE_TRIGGERS.includes(recipe.trigger.type) && !recipe.trigger.value) {
        return "Choose the value that fires the trigger";
    }

    for (const condition of recipe.conditions) {
        if (!(CONDITION_SOURCES as readonly string[]).includes(condition.source)) {
            return "One of the conditions is not readable";
        }
        if (!(CONDITION_OPS as readonly string[]).includes(condition.op)) {
            return "One of the conditions uses an unknown comparison";
        }
        if (condition.source === "column" && workspaceScoped && condition.column) {
            return "A workspace automation matches columns by name, not from one module";
        }
    }

    if (recipe.actions.length === 0) return "Add at least one action";

    for (const action of recipe.actions) {
        if (!(ACTION_TYPES as readonly string[]).includes(action.type)) {
            return "One of the actions is not supported";
        }

        if (COLUMN_ACTIONS.includes(action.type)) {
            const named = workspaceScoped ? action.columnName : action.column;
            if (!named) return "Choose the column to set";
            if (workspaceScoped && action.column) {
                return "A workspace automation matches columns by name, not from one module";
            }
        }

        if (COLLECTION_ACTIONS.includes(action.type)) {
            if (workspaceScoped) {
                // A collection belongs to one module, so this action can only
                // ever fire on that module — which is not what was asked for.
                return "Moving to a collection only works on a single-module automation";
            }
            if (!action.collectionName) return "Choose the collection to move into";
        }

        if (action.type === "create_record" && !action.targetCollection) {
            return "Choose where the new record goes";
        }

        if (TEXT_ACTIONS.includes(action.type) && !action.value.trim()) {
            // set_column_value is the exception: writing a blank is a real
            // instruction, and clear_column_value is not offered on every UI.
            if (action.type !== "set_column_value") {
                return `Fill in ${ACTION_LABELS[action.type] ?? "the action's value"}`;
            }
        }
    }

    return null;
}
