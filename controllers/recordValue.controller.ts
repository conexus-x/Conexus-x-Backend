import { Request, Response } from "express";
import mongoose from "mongoose";
import { resolveModuleReferences } from "../services/reference.service";
import { paginationMeta, parsePagination } from "../utils/pagination";
import { AuthRequest } from "./wrokspace.controller";
import RecordValue from "../models/RecordValue";
import { touchModule, touchWorkspace } from "../utils/workspaceHelper";
import { describeValue, logActivity } from "../services/activity.service";
import { emitColumnChange } from "../services/automation/emit";
import { emitChange, originOf } from "../services/realtime.service";

export const createRecordValue = async (req: AuthRequest, res: Response) => {
    try {

        const {
            workspace,
            module: moduleId,
            collectionName,
            record,
            column,
            value
        } = req.body;

        const exists = await RecordValue.findOne({
            record: new mongoose.Types.ObjectId(record as string),
            column: new mongoose.Types.ObjectId(column as string)
        });

        /**
         * A cell write is idempotent: writing to a cell that already has a row
         * means "set it to this", not "conflict".
         *
         * Returning 400 here was a real trap — the client only knows to call the
         * update endpoint if the existing row happens to be in its cache, and
         * when it was not (a fresh pick on a cell whose values had not loaded)
         * the write failed silently and the value vanished on the next refresh.
         */
        if (exists) {
            const before = exists.value;

            exists.value = value;
            await exists.save();

            await touchWorkspace(exists.workspace);
            await touchModule(exists.module);

            await logActivity({
                workspace: exists.workspace,
                user: req.user?.id,
                action: "cell_updated",
                module: exists.module,
                collectionName: exists.collectionName,
                record: exists.record,
                column: exists.column,
                before,
                after: value,
                message: `updated a cell`
            });

            emitChange({
                entity: "recordValue",
                action: "updated",
                id: String(exists._id),
                workspaceId: String(exists.workspace),
                moduleId: String(exists.module),
                collectionId: String(exists.collectionName),
                recordId: String(exists.record),
                columnId: String(exists.column),
                data: exists,
                actorId: req.user?.id,
                originId: originOf(req)
            });

            return res.status(200).json({
                message: "Value updated",
                recordValue: exists
            });
        }

        const Column = mongoose.model("Column");
        const col = await Column.findById(column);
        if (col) {
            if (col.type === "phone" && value && !/^[0-9+\-\s()]*$/.test(value)) {
                return res.status(400).json({ message: "Invalid phone number format" });
            }
            if (col.type === "number" && value && isNaN(Number(value))) {
                return res.status(400).json({ message: "Value must be a valid number" });
            }
            if (col.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                return res.status(400).json({ message: "Invalid email format" });
            }
        }

        const recordValue = await RecordValue.create({
            workspace: new mongoose.Types.ObjectId(workspace as string),
            module: new mongoose.Types.ObjectId(moduleId as string),
            collectionName: new mongoose.Types.ObjectId(collectionName as string),
            record: new mongoose.Types.ObjectId(record as string),
            column: new mongoose.Types.ObjectId(column as string),
            value,
            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)
        });

        await touchWorkspace(workspace);
        await touchModule(moduleId);

        await logActivity({
            workspace,
            user: req.user?.id,
            action: "cell_updated",
            module: moduleId,
            collectionName,
            record,
            column,
            targetName: col?.name || col?.label || "",
            before: null,
            after: value,
            message: `set ${col?.name || "a field"} to ${describeValue(value)}`
        });

        // Not awaited: automations must never delay or fail the user's write.
        // emitColumnChange picks the record vs sub-record trigger pair — the
        // same endpoint writes both kinds of cell.
        void emitColumnChange({
            workspace, module: moduleId, record, column,
            user: req.user?.id as string,
            before: null, after: value
        });

        emitChange({
            entity: "recordValue",
            action: "created",
            id: String(recordValue._id),
            workspaceId: String(workspace),
            moduleId: String(moduleId),
            collectionId: String(collectionName),
            recordId: String(record),
            columnId: String(column),
            data: recordValue,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(201).json({

            message: "Value created successfully",

            recordValue

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }
};

export const getRecordValues = async (req: Request, res: Response) => {

    try {

        const { recordId } = req.params;

        const filter = {
            record: new mongoose.Types.ObjectId(recordId as string)
        };

        const pagination = parsePagination(req.query);

        const query = RecordValue.find(filter).populate("column");

        if (pagination.enabled) {
            query.skip(pagination.skip).limit(pagination.limit);
        }

        const values = await query;

        if (!pagination.enabled) {
            return res.status(200).json({ values });
        }

        res.status(200).json({
            values,
            pagination: paginationMeta(
                await RecordValue.countDocuments(filter),
                pagination
            )
        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }

};

export const updateRecordValue = async (req: AuthRequest, res: Response) => {

    try {

        const { recordValueId } = req.params;

        const { value } = req.body;

        const existingRv = await RecordValue.findById(recordValueId);
        if (!existingRv) {
            return res.status(404).json({ message: "Record value not found" });
        }

        const Column = mongoose.model("Column");
        const col = await Column.findById(existingRv.column);
        if (col) {
            if (col.type === "phone" && value && !/^[0-9+\-\s()]*$/.test(value)) {
                return res.status(400).json({ message: "Invalid phone number format" });
            }
            if (col.type === "number" && value && isNaN(Number(value))) {
                return res.status(400).json({ message: "Value must be a valid number" });
            }
            if (col.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                return res.status(400).json({ message: "Invalid email format" });
            }
        }

        const recordValue = await RecordValue.findByIdAndUpdate(
            recordValueId,
            { value },
            { returnDocument: "after" }
        );

        if (!recordValue) {

            return res.status(404).json({

                message: "Record value not found"

            });

        }

        await touchWorkspace(recordValue.workspace);
        await touchModule(recordValue.module);

        // existingRv was read before the update, so it still holds the old value.
        await logActivity({
            workspace: recordValue.workspace,
            user: req.user?.id,
            action: "cell_updated",
            module: recordValue.module,
            collectionName: recordValue.collectionName,
            record: recordValue.record,
            column: recordValue.column,
            targetName: col?.name || col?.label || "",
            before: existingRv.value,
            after: value,
            message: `changed ${col?.name || "a field"} from ${describeValue(existingRv.value)} to ${describeValue(value)}`
        });

        const trigger = {
            workspace: recordValue.workspace,
            module: recordValue.module,
            record: recordValue.record,
            column: recordValue.column,
            user: req.user?.id as string,
            before: existingRv.value,
            after: value
        };

        void emitColumnChange(trigger);

        emitChange({
            entity: "recordValue",
            action: "updated",
            id: String(recordValue._id),
            workspaceId: String(recordValue.workspace),
            moduleId: String(recordValue.module),
            collectionId: String(recordValue.collectionName),
            recordId: String(recordValue.record),
            columnId: String(recordValue.column),
            data: recordValue,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(200).json({

            message: "Value updated successfully",

            recordValue

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }

};

export const deleteRecordValue = async (req: AuthRequest, res: Response) => {

    try {

        const { recordValueId } = req.params;

        const recordValue = await RecordValue.findByIdAndDelete(

            recordValueId

        );

        if (!recordValue) {

            return res.status(404).json({

                message: "Record value not found"

            });

        }

        await touchWorkspace(recordValue.workspace);
        await touchModule(recordValue.module);

        await logActivity({
            workspace: recordValue.workspace,
            user: req.user?.id,
            action: "cell_updated",
            module: recordValue.module,
            collectionName: recordValue.collectionName,
            record: recordValue.record,
            column: recordValue.column,
            before: recordValue.value,
            after: null,
            message: `cleared ${describeValue(recordValue.value)}`
        });

        emitChange({
            entity: "recordValue",
            action: "deleted",
            id: String(recordValue._id),
            workspaceId: String(recordValue.workspace),
            moduleId: String(recordValue.module),
            collectionId: String(recordValue.collectionName),
            recordId: String(recordValue.record),
            columnId: String(recordValue.column),
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(200).json({

            message: "Value deleted successfully"

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }

};


// GET /api/record-values/references/:moduleId
/**
 * Every reference column on a module, resolved for every record in one pass.
 *
 * Board-wide rather than per record on purpose: a reference reads through a
 * relation into another module's values, and doing that per row would be four
 * queries times however many rows are on screen.
 */
export const getModuleReferences = async (req: Request, res: Response) => {

    try {

        const { moduleId } = req.params;

        const references = await resolveModuleReferences(String(moduleId));

        return res.json({ references });

    } catch (error: any) {

        console.error("Reference resolve error:", error.message);

        return res.status(500).json({ message: "Could not resolve references" });

    }

};
