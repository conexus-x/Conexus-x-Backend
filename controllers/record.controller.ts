import { Request, Response } from "express";
import mongoose from "mongoose";
import { paginationMeta, parsePagination, parseSort } from "../utils/pagination";
import { AuthRequest } from "./wrokspace.controller";
import Record from "../models/Record";
import Collection from "../models/Collection";
import Module from "../models/Module";
import Comment from "../models/Comment";
import { touchModule, touchWorkspace } from "../utils/workspaceHelper";
import { seedSubColumns } from "../utils/subColumns";
import { logActivity } from "../services/activity.service";
import { runAutomations } from "../services/automation.service";
import { emitIfChecklistFinished } from "../services/automation/emit";
import { emitChange, originOf } from "../services/realtime.service";

export const createRecord = async (req: AuthRequest, res: Response) => {
    try {

        const { collectionId } = req.params;
        const { name } = req.body;
        const collection = await Collection.findById(collectionId);
        if (!collection) {
            return res.status(404).json({
                message: "Collection not found"
            });
        }

        const moduleItem = await Module.findById(collection.module);

        if (!moduleItem) {
            return res.status(404).json({
                message: "Module not found"
            });
        }

        // Sub-records are positioned within their parent, not within the
        // collection, so they must not decide where the next top-level row lands.
        const lastRecord = await Record.findOne({
            collectionName: new mongoose.Types.ObjectId(collectionId as string),
            parentRecord: null
        }).sort({ position: -1 });
        const record = await Record.create({
            workspace: moduleItem.workspace,
            module: collection.module,
            collectionName: new mongoose.Types.ObjectId(collectionId as string),
            name,
            position: lastRecord ? lastRecord.position + 1 : 0,
            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)
        });

        await touchWorkspace(moduleItem.workspace);
        await touchModule(collection.module);

        await logActivity({
            workspace: moduleItem.workspace,
            user: req.user?.id,
            action: "record_created",
            module: collection.module,
            collectionName: String(collectionId),
            record: record._id,
            targetName: record.name,
            after: record.name,
            message: `created record "${record.name}"`
        });

        void runAutomations({
            type: "record_created",
            workspace: moduleItem.workspace,
            module: collection.module,
            record: record._id,
            collectionName: String(collectionId),
            user: req.user?.id as string
        });

        emitChange({
            entity: "record",
            action: "created",
            id: String(record._id),
            workspaceId: String(moduleItem.workspace),
            moduleId: String(collection.module),
            collectionId: String(collectionId),
            data: record,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(201).json({ message: "Record created successfully", record });
    }
    catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};



export const getCollectionRecords = async (req: Request, res: Response) => {
    try {
        const { collectionId } = req.params;

        // `parentRecord: null` also matches rows written before sub-records
        // existed, where the field is absent — Mongo treats missing as null.
        const filter = {
            collectionName: new mongoose.Types.ObjectId(collectionId as string),
            isArchived: false,
            parentRecord: null
        };

        const pagination = parsePagination(req.query);
        const sort = parseSort(
            req.query,
            ["position", "name", "createdAt", "updatedAt"],
            { position: 1 }
        );

        const query = Record.find(filter).sort(sort).lean();

        if (pagination.enabled) {
            query.skip(pagination.skip).limit(pagination.limit);
        }

        const records = await withAmendmentCounts(await withSubRecordCounts(await query));

        // The count is only paid for when a page was actually asked for.
        if (!pagination.enabled) {
            return res.status(200).json({ records });
        }

        const total = await Record.countDocuments(filter);

        res.status(200).json({
            records,
            pagination: paginationMeta(total, pagination)
        });
    }
    catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};



/**
 * How many sub-records each row carries, in one grouped query rather than one
 * per row. The board draws this on the expand toggle, so it has to arrive with
 * the rows — otherwise every collapsed row would have to be opened to find out
 * whether there is anything inside it.
 */
const withSubRecordCounts = async <T extends { _id: unknown }>(records: T[]) => {
    if (records.length === 0) return records;

    const counts = await Record.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
        {
            $match: {
                parentRecord: {
                    $in: records.map((r) => new mongoose.Types.ObjectId(String(r._id)))
                },
                isArchived: false
            }
        },
        { $group: { _id: "$parentRecord", count: { $sum: 1 } } }
    ]);

    const byParent = new Map(counts.map((row) => [String(row._id), row.count]));

    return records.map((record) => ({
        ...record,
        subRecordCount: byParent.get(String(record._id)) ?? 0
    }));
};


/**
 * How many amendments each row carries, counted the same way as sub-records:
 * one grouped query for the whole page rather than one per row. The board draws
 * it on the amendments bubble, so a row cannot be made to ask for its own count
 * without turning a 30-row board into 30 requests.
 */
const withAmendmentCounts = async <T extends { _id: unknown }>(records: T[]) => {
    if (records.length === 0) return records;

    const counts = await Comment.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
        {
            $match: {
                record: {
                    $in: records.map((r) => new mongoose.Types.ObjectId(String(r._id)))
                },
                isDeleted: false
            }
        },
        { $group: { _id: "$record", count: { $sum: 1 } } }
    ]);

    const byRecord = new Map(counts.map((row) => [String(row._id), row.count]));

    return records.map((record) => ({
        ...record,
        amendmentCount: byRecord.get(String(record._id)) ?? 0
    }));
};


export const createSubRecord = async (req: AuthRequest, res: Response) => {
    try {
        const { recordId } = req.params;
        const { name } = req.body;

        const parent = await Record.findById(recordId);
        if (!parent) {
            return res.status(404).json({ message: "Record not found" });
        }

        // A sub-record of a sub-record has nowhere to be drawn, and monday does
        // not have one either. One level is the contract.
        if (parent.parentRecord) {
            return res.status(400).json({
                message: "A sub-record cannot have sub-records of its own"
            });
        }

        await seedSubColumns(
            parent.module as mongoose.Types.ObjectId,
            req.user?.id as string
        );

        const last = await Record.findOne({ parentRecord: parent._id }).sort({ position: -1 });

        const record = await Record.create({
            workspace: parent.workspace,
            module: parent.module,
            // Inherited, so every module/collection-scoped query keeps working;
            // the board's own list filters sub-records back out by parentRecord.
            collectionName: parent.collectionName,
            parentRecord: parent._id,
            name,
            position: last ? last.position + 1 : 0,
            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)
        });

        await touchWorkspace(parent.workspace);
        await touchModule(parent.module);

        await logActivity({
            workspace: parent.workspace,
            user: req.user?.id,
            action: "record_created",
            module: parent.module,
            collectionName: String(parent.collectionName),
            record: record._id,
            targetName: record.name,
            after: record.name,
            message: `added sub-record "${record.name}" under "${parent.name}"`
        });

        /**
         * Its own trigger, not record_created. A board recipe reads "when a
         * record is created" and must not fire on a checklist line, so the
         * two are separate trigger types and the engine's subject guard keeps
         * each on its own kind of row.
         */
        void runAutomations({
            type: "subrecord_created",
            workspace: parent.workspace,
            module: parent.module,
            record: record._id,
            collectionName: String(parent.collectionName),
            user: req.user?.id as string,
            after: record.name
        });

        // parentRecordId is what makes this patchable: a sub-record lives in
        // getSubRecords(parent), never in the collection's own list.
        emitChange({
            entity: "record",
            action: "created",
            id: String(record._id),
            workspaceId: String(parent.workspace),
            moduleId: String(parent.module),
            collectionId: String(parent.collectionName),
            parentRecordId: String(parent._id),
            data: record,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(201).json({ message: "Sub-record created successfully", record });
    }
    catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};


export const getSubRecords = async (req: Request, res: Response) => {
    try {
        const { recordId } = req.params;

        // .lean() because withAmendmentCounts spreads each row — spreading a
        // hydrated mongoose document copies its internals, not its fields.
        const rows = await Record.find({
            parentRecord: new mongoose.Types.ObjectId(recordId as string),
            isArchived: false
        })
            .sort({ position: 1 })
            .lean();

        // A sub-record carries amendments exactly as a record does, so its row
        // needs the same count to draw the same bubble.
        const records = await withAmendmentCounts(rows);

        res.status(200).json({ records });
    }
    catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};


export const updateRecord = async (req: AuthRequest, res: Response) => {
    try {
        const { recordId } = req.params;

        // Read first: findByIdAndUpdate returns the NEW doc, so the old values
        // have to be captured before the write to log a from -> to.
        const previous = await Record.findById(recordId);

        const record = await Record.findByIdAndUpdate(recordId, req.body, { returnDocument: "after" });
        if (!record) {
            return res.status(404).json({ message: "Record not found" });
        }
        await touchWorkspace(record.workspace);
        await touchModule(record.module);

        const movedCollection =
            previous &&
            String(previous.collectionName) !== String(record.collectionName);

        const renamed = previous && previous.name !== record.name;

        if (movedCollection) {
            await logActivity({
                workspace: record.workspace,
                user: req.user?.id,
                action: "record_moved",
                module: record.module,
                collectionName: record.collectionName,
                record: record._id,
                targetName: record.name,
                before: String(previous!.collectionName),
                after: String(record.collectionName),
                message: `moved "${record.name}" to another collection`
            });

            void runAutomations({
                type: "record_moved",
                workspace: record.workspace,
                module: record.module,
                record: record._id,
                collectionName: record.collectionName,
                user: req.user?.id as string,
                before: String(previous!.collectionName),
                after: String(record.collectionName)
            });
        } else if (renamed) {
            await logActivity({
                workspace: record.workspace,
                user: req.user?.id,
                action: "record_updated",
                module: record.module,
                collectionName: record.collectionName,
                record: record._id,
                targetName: record.name,
                before: previous!.name,
                after: record.name,
                message: `renamed record "${previous!.name}" to "${record.name}"`
            });

            // Board rows only: a sub-record rename is not a record_renamed, and
            // the engine's subject guard would drop it anyway.
            if (!record.parentRecord) {
                void runAutomations({
                    type: "record_renamed",
                    workspace: record.workspace,
                    module: record.module,
                    record: record._id,
                    user: req.user?.id as string,
                    before: previous!.name,
                    after: record.name
                });
            }
        }
        // A bare position change is reordering noise — not worth an audit row.

        /**
         * Completion is its own event, independent of the move/rename branches
         * above — one PUT can tick a record complete AND move it, and a recipe
         * watching for completion must not lose to whichever branch ran first.
         *
         * No activity row is written here: nothing logged completion before
         * this change, and adding an audit row for it is a separate decision
         * from wiring the trigger.
         */
        const completionChanged =
            previous && Boolean(previous.isCompleted) !== Boolean(record.isCompleted);

        if (completionChanged) {
            const nowComplete = Boolean(record.isCompleted);

            const event = {
                workspace: record.workspace,
                module: record.module,
                record: record._id,
                user: req.user?.id as string,
                before: String(!nowComplete),
                after: String(nowComplete)
            };

            if (record.parentRecord) {
                if (nowComplete) {
                    void runAutomations({ type: "subrecord_completed", ...event });

                    // Ticking this one may have finished the whole checklist,
                    // which fires on the PARENT. Decided against the database
                    // rather than against what we think we just changed.
                    void emitIfChecklistFinished({
                        parentRecordId: record.parentRecord,
                        workspace: record.workspace,
                        module: record.module,
                        user: req.user?.id as string
                    });
                }
            } else {
                void runAutomations({
                    type: nowComplete ? "record_completed" : "record_uncompleted",
                    ...event
                });
            }
        }

        /**
         * A move is announced as its own action and carries BOTH collection
         * ids. The receiving client has to remove the row from one list and
         * add it to the other, and it cannot work out where the row came from
         * by looking at the new document — the old collection is only knowable
         * here, exactly as the updateRecord invalidation already needs it.
         */
        emitChange({
            entity: "record",
            action: movedCollection ? "moved" : "updated",
            id: String(record._id),
            workspaceId: String(record.workspace),
            moduleId: String(record.module),
            collectionId: String(record.collectionName),
            fromCollectionId: movedCollection
                ? String(previous!.collectionName)
                : undefined,
            parentRecordId: record.parentRecord
                ? String(record.parentRecord)
                : undefined,
            data: record,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(200).json({ message: "Record updated successfully", record });

    }
    catch (error: any) {
        res.status(500).json({ message: error.message });
    }

};

export const deleteRecord = async (req: AuthRequest, res: Response) => {
    try {
        const { recordId } = req.params;
        const record = await Record.findByIdAndUpdate(recordId, {
            isArchived: true
        }, { returnDocument: "after" });

        if (!record) {
            return res.status(404).json({ message: "Record not found" });
        }
        // Archiving a parent takes its sub-records with it — they are only
        // reachable through the row that just disappeared, so leaving them
        // behind creates rows nothing can ever show or remove again.
        const archivedChildren = record.parentRecord
            ? { modifiedCount: 0 }
            : await Record.updateMany(
                { parentRecord: record._id, isArchived: false },
                { isArchived: true }
            );

        await touchWorkspace(record.workspace);
        await touchModule(record.module);

        await logActivity({
            workspace: record.workspace,
            user: req.user?.id,
            action: "record_deleted",
            module: record.module,
            collectionName: record.collectionName,
            record: record._id,
            targetName: record.name,
            before: record.name,
            after: null,
            message: archivedChildren.modifiedCount
                ? `archived record "${record.name}" and its ${archivedChildren.modifiedCount} sub-record${archivedChildren.modifiedCount === 1 ? "" : "s"}`
                : `archived record "${record.name}"`
        });

        if (record.parentRecord) {
            /**
             * Archiving the last OUTSTANDING line finishes the checklist just
             * as completing it would — the row is gone from the sub-grid
             * either way, so a recipe watching for "everything under this
             * record is done" has to hear about it.
             */
            void emitIfChecklistFinished({
                parentRecordId: record.parentRecord,
                workspace: record.workspace,
                module: record.module,
                user: req.user?.id as string
            });
        } else {
            void runAutomations({
                type: "record_archived",
                workspace: record.workspace,
                module: record.module,
                record: record._id,
                collectionName: record.collectionName,
                user: req.user?.id as string,
                before: record.name,
                after: null
            });
        }

        emitChange({
            entity: "record",
            action: "deleted",
            id: String(record._id),
            workspaceId: String(record.workspace),
            moduleId: String(record.module),
            collectionId: String(record.collectionName),
            parentRecordId: record.parentRecord
                ? String(record.parentRecord)
                : undefined,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(200).json({
            message: "Record archived successfully",
            archivedSubRecords: archivedChildren.modifiedCount
        });
    }
    catch (error: any) {
        res.status(500).json({ message: error.message });

    }

};