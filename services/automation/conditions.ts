import RecordModel from "../../models/Record";
import RecordValue from "../../models/RecordValue";
import Comment from "../../models/Comment";
import type { IAutomationCondition } from "../../models/Automation";
import type { ColumnResolver } from "./columns";
import { asNumber, same, str } from "./values";
import type { AutomationEvent, IAutomation } from "./types";
import type { IRecord } from "../../models/Record";

/** Reads the record's current cell values, keyed by column id. */
export async function loadCells(recordId: AutomationEvent["record"]) {
    const values = await RecordValue.find({ record: recordId }).lean();
    const byColumn = new Map<string, unknown>();
    values.forEach((v) => byColumn.set(String(v.column), v.value));
    return byColumn;
}

/**
 * One record's worth of facts a condition might ask about.
 *
 * The two counts are loaded LAZILY and memoised. Most recipes never test them,
 * and charging every cell write on the board two extra countDocuments() for a
 * question nobody asked is how a trigger stops being cheap.
 */
class Facts {
    private subrecordCount?: number;
    private amendmentCount?: number;

    constructor(private record: IRecord) { }

    async subrecords(): Promise<number> {
        if (this.subrecordCount === undefined) {
            this.subrecordCount = await RecordModel.countDocuments({
                parentRecord: this.record._id,
                isArchived: false
            });
        }
        return this.subrecordCount;
    }

    async amendments(): Promise<number> {
        if (this.amendmentCount === undefined) {
            this.amendmentCount = await Comment.countDocuments({
                record: this.record._id
            });
        }
        return this.amendmentCount;
    }
}

/** What a single condition is comparing against. */
async function actualValue(
    condition: IAutomationCondition,
    record: IRecord,
    cells: Map<string, unknown>,
    facts: Facts,
    columns: ColumnResolver,
    moduleId: AutomationEvent["module"],
    columnScope: "record" | "subrecord"
): Promise<unknown> {
    if (condition.source === "record") {
        switch (condition.field) {
            case "name":
                return record.name;
            case "collection":
                return String(record.collectionName);
            case "is_completed":
                return String(Boolean(record.isCompleted));
            case "is_archived":
                return String(Boolean(record.isArchived));
            case "subrecord_count":
                return await facts.subrecords();
            case "amendment_count":
                return await facts.amendments();
            default:
                return "";
        }
    }

    const columnId = await columns.resolve(condition, moduleId, columnScope);
    // A column this board does not have. Reads as empty, which is the truthful
    // answer — "is empty" holds, "is Done" does not.
    if (!columnId) return "";

    return cells.get(String(columnId));
}

function compare(op: IAutomationCondition["op"], actual: unknown, expected: unknown): boolean {
    switch (op) {
        case "is":
            return same(actual, expected);
        case "is_not":
            return !same(actual, expected);
        case "is_empty":
            return str(actual).trim() === "";
        case "is_not_empty":
            return str(actual).trim() !== "";
        case "contains":
            return str(actual).toLowerCase().includes(str(expected).toLowerCase());
        case "not_contains":
            return !str(actual).toLowerCase().includes(str(expected).toLowerCase());
        case "starts_with":
            return str(actual).toLowerCase().startsWith(str(expected).toLowerCase());
        case "greater_than": {
            const a = asNumber(actual);
            const b = asNumber(expected);
            return a !== null && b !== null && a > b;
        }
        case "less_than": {
            const a = asNumber(actual);
            const b = asNumber(expected);
            return a !== null && b !== null && a < b;
        }
        default:
            return false;
    }
}

/**
 * Whether this recipe's conditions hold for the record that triggered it.
 *
 * `match` decides between AND and OR across the whole list. Nested groups are
 * not modelled: two levels of grouping is a query builder, and a flat all/any
 * covers the recipes people actually write.
 */
export async function conditionsHold(
    automation: IAutomation,
    event: AutomationEvent,
    record: IRecord,
    cells: Map<string, unknown>,
    columns: ColumnResolver,
    columnScope: "record" | "subrecord"
): Promise<boolean> {
    const list = automation.conditions ?? [];
    // No conditions means the trigger alone decides — for "any" too, which
    // would otherwise vacuously fail and make the recipe dead on arrival.
    if (list.length === 0) return true;

    const facts = new Facts(record);
    const wantAll = automation.match !== "any";

    for (const condition of list) {
        const actual = await actualValue(
            condition,
            record,
            cells,
            facts,
            columns,
            event.module,
            columnScope
        );

        const holds = compare(condition.op, actual, condition.value);

        if (wantAll && !holds) return false;
        if (!wantAll && holds) return true;
    }

    return wantAll;
}
