// services/reference.service.ts

import mongoose from "mongoose";
import Column from "../models/Column";
import Record from "../models/Record";
import RecordValue from "../models/RecordValue";

/**
 * Reference columns — monday calls them mirror columns.
 *
 * A `relation` column links records here to records on another module; its
 * value is a JSON array of record ids, the same encoding the person column uses
 * for users. Give it a `displayField` and it also SHOWS a chosen column's value
 * from whatever it links to — the mirror, folded into the column that owns the
 * link rather than split across two.
 *
 * The older standalone `reference` type (settings.via + settings.field) is no
 * longer offered when adding a column, but still resolves here so boards that
 * already have one keep working.
 *
 * The value is never stored. That is the whole point: edit the source record and
 * every reference to it is already correct, with nothing to keep in sync. It
 * also means a reference is read-only — writing one would have no home to write
 * to.
 *
 * Resolution is per MODULE, not per record: a board of 200 rows costs the same
 * four queries as a board of 3.
 */

export type ReferenceAggregate = "list" | "count" | "sum" | "avg" | "min" | "max";

export interface ReferenceItem {
    recordId: string;
    name: string;
    value: string;
}

export interface ResolvedReference {
    /** The linked records and what they hold for the referenced column. */
    items: ReferenceItem[];
    /** Ready-to-render text — the client never re-derives this. */
    display: string;
    /** Set for the numeric aggregates, so a cell can right-align it. */
    numeric?: number;
}

/** recordId -> columnId -> resolved */
export type ReferenceMap = Record<string, Record<string, ResolvedReference>>;

/** A relation cell is a JSON id array; older single ids still read. */
export const parseRelationValue = (raw: unknown): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
    if (typeof raw !== "string") return [];

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
        return parsed ? [String(parsed)] : [];
    } catch {
        return raw.trim() ? [raw.trim()] : [];
    }
};

const toNumber = (value: string): number | null => {
    if (!value?.trim()) return null;

    // Currency and thousands separators are stripped, but what is left must
    // still BE a number: "Open" reduces to "" and Number("") is 0, which would
    // have made a sum over a text column read as zero rather than blank.
    const cleaned = value.replace(/[^0-9.\-]/g, "");

    if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;

    const parsed = Number(cleaned);

    return Number.isFinite(parsed) ? parsed : null;
};

/** Exported so the aggregate rules can be pinned by a test, not assumed. */
export const summariseReference = (
    items: ReferenceItem[],
    aggregate: ReferenceAggregate
): { display: string; numeric?: number } => {

    if (aggregate === "count") {
        return { display: String(items.length), numeric: items.length };
    }

    const numbers = items
        .map((item) => toNumber(item.value))
        .filter((value): value is number => value !== null);

    if (aggregate !== "list") {
        if (numbers.length === 0) return { display: "" };

        const total = numbers.reduce((sum, value) => sum + value, 0);

        const result =
            aggregate === "sum"
                ? total
                : aggregate === "avg"
                    ? total / numbers.length
                    : aggregate === "min"
                        ? Math.min(...numbers)
                        : Math.max(...numbers);

        // Trim the float dust an average leaves behind.
        const rounded = Math.round(result * 100) / 100;

        return { display: String(rounded), numeric: rounded };
    }

    return {
        display: items
            .map((item) => item.value)
            .filter(Boolean)
            .join(", ")
    };
};

/**
 * Resolve every reference column on one module, for every record on it.
 */
export const resolveModuleReferences = async (
    moduleId: string
): Promise<ReferenceMap> => {

    if (!mongoose.isValidObjectId(moduleId)) return {};

    const candidates = await Column.find({
        module: new mongoose.Types.ObjectId(moduleId),
        type: { $in: ["relation", "reference"] }
    })
        .select("type settings")
        .lean();

    /**
     * Both shapes reduce to the same three facts: which cell holds the links,
     * which column to read at the far end, and how to combine several.
     */
    const usable = candidates
        .map((column) => {
            const settings = column.settings ?? {};

            // A relation shows a value through ITSELF.
            if (column.type === "relation") {
                return settings.displayField
                    ? {
                        columnId: String(column._id),
                        via: String(column._id),
                        field: String(settings.displayField),
                        aggregate: settings.aggregate ?? "list",
                        // Absent on every mirror created before sub-record
                        // targets existed, which means the linked record itself.
                        scope: settings.targetScope === "subrecord"
                            ? "subrecord" as const
                            : "record" as const
                    }
                    : null;
            }

            // Legacy reference: travels a separate relation column.
            return settings.via && settings.field
                ? {
                    columnId: String(column._id),
                    via: String(settings.via),
                    field: String(settings.field),
                    aggregate: settings.aggregate ?? "list",
                    // The retired standalone type never had a scope.
                    scope: "record" as const
                }
                : null;
        })
        .filter(Boolean) as {
            columnId: string;
            via: string;
            field: string;
            aggregate: ReferenceAggregate;
            scope: "record" | "subrecord";
        }[];

    if (usable.length === 0) return {};

    // 1. every relation cell those columns travel through
    const relationColumnIds = Array.from(
        new Set(usable.map((column) => column.via))
    ).map((id) => new mongoose.Types.ObjectId(id));

    const relationValues = await RecordValue.find({
        module: new mongoose.Types.ObjectId(moduleId),
        column: { $in: relationColumnIds }
    })
        .select("record column value")
        .lean();

    if (relationValues.length === 0) return {};

    // recordId -> relationColumnId -> linked record ids
    const linksByRecord = new Map<string, Map<string, string[]>>();
    const linkedIds = new Set<string>();

    for (const row of relationValues) {
        const ids = parseRelationValue(row.value).filter((id) =>
            mongoose.isValidObjectId(id)
        );

        if (ids.length === 0) continue;

        const recordKey = String(row.record);
        const byColumn = linksByRecord.get(recordKey) ?? new Map<string, string[]>();

        byColumn.set(String(row.column), ids);
        linksByRecord.set(recordKey, byColumn);

        ids.forEach((id) => linkedIds.add(id));
    }

    if (linkedIds.size === 0) return {};

    const linkedObjectIds = Array.from(linkedIds).map(
        (id) => new mongoose.Types.ObjectId(id)
    );

    // 2. the names of everything linked, so a list can read as names not ids
    const linkedRecords = await Record.find({ _id: { $in: linkedObjectIds } })
        .select("name")
        .lean();

    const nameById = new Map(
        linkedRecords.map((record) => [String(record._id), record.name])
    );

    /**
     * 2b. Sub-record targets.
     *
     * A mirror whose scope is "subrecord" does not read the linked record's own
     * cell — it reads the cells of that record's CHILDREN, so one link can
     * contribute many values and the aggregate earns its keep. Two extra reads,
     * and only when such a column actually exists on the module.
     */
    const subScoped = usable.filter((column) => column.scope === "subrecord");

    const childrenByParent = new Map<string, { id: string; name: string }[]>();
    const childValueByRecordColumn = new Map<string, string>();

    if (subScoped.length > 0) {
        const children = await Record.find({
            parentRecord: { $in: linkedObjectIds },
            isArchived: false
        })
            .select("name parentRecord")
            .sort({ position: 1 })
            .lean();

        for (const child of children) {
            const key = String(child.parentRecord);
            const list = childrenByParent.get(key) ?? [];
            list.push({ id: String(child._id), name: child.name });
            childrenByParent.set(key, list);
        }

        if (children.length > 0) {
            const childValues = await RecordValue.find({
                record: { $in: children.map((child) => child._id) },
                column: {
                    $in: Array.from(new Set(subScoped.map((column) => column.field))).map(
                        (id) => new mongoose.Types.ObjectId(id)
                    )
                }
            })
                .select("record column value")
                .lean();

            for (const row of childValues) {
                childValueByRecordColumn.set(
                    `${String(row.record)}:${String(row.column)}`,
                    String(row.value ?? "")
                );
            }
        }
    }

    // 3. the far-side values, in one read
    const fieldColumnIds = Array.from(
        new Set(usable.map((column) => column.field))
    ).map((id) => new mongoose.Types.ObjectId(id));

    const fieldValues = await RecordValue.find({
        record: { $in: linkedObjectIds },
        column: { $in: fieldColumnIds }
    })
        .select("record column value")
        .lean();

    const valueByRecordColumn = new Map<string, string>();

    for (const row of fieldValues) {
        valueByRecordColumn.set(
            `${String(row.record)}:${String(row.column)}`,
            String(row.value ?? "")
        );
    }

    // 4. compose
    const map: ReferenceMap = {};

    for (const [recordId, byColumn] of linksByRecord) {
        for (const column of usable) {
            const ids = byColumn.get(column.via);
            if (!ids?.length) continue;

            const items: ReferenceItem[] =
                column.scope === "subrecord"
                    // One entry per SUB-RECORD of each linked record. A link
                    // whose record has no children contributes nothing, which
                    // is what makes an empty mirror read as empty.
                    ? ids.flatMap((id) =>
                        (childrenByParent.get(id) ?? []).map((child) => ({
                            recordId: child.id,
                            name: child.name,
                            value:
                                childValueByRecordColumn.get(
                                    `${child.id}:${column.field}`
                                ) ?? ""
                        }))
                    )
                    : ids.map((id) => ({
                        recordId: id,
                        name: nameById.get(id) ?? "Unknown",
                        value: valueByRecordColumn.get(`${id}:${column.field}`) ?? ""
                    }));

            map[recordId] = map[recordId] ?? {};
            map[recordId][column.columnId] = {
                items,
                ...summariseReference(items, column.aggregate)
            };
        }
    }

    return map;
};
