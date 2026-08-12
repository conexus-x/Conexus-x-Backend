import { Request, Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import RecordValue from "../models/RecordValue";
import { touchWorkspace } from "../utils/workspaceHelper";

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

        if (exists) {
            return res.status(400).json({
                message: "Value already exists"
            });
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

        const values = await RecordValue.find({

            record: new mongoose.Types.ObjectId(recordId as string)

        }).populate("column");

        res.status(200).json({

            values

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }

};

export const updateRecordValue = async (req: Request, res: Response) => {

    try {

        const { recordValueId } = req.params;

        const { value } = req.body;

        const recordValue = await RecordValue.findByIdAndUpdate(

            recordValueId,

            {
                value
            },

            {
                new: true
            }

        );

        if (!recordValue) {

            return res.status(404).json({

                message: "Record value not found"

            });

        }

        await touchWorkspace(recordValue.workspace);

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

export const deleteRecordValue = async (req: Request, res: Response) => {

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