import { Request, Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import Record from "../models/Record";
import Collection from "../models/Collection";
import Module from "../models/Module";
import { touchWorkspace } from "../utils/workspaceHelper";

export const createRecord = async (req: AuthRequest, res: Response) => {
    try {

        const { collectionId } = req.params;

        const {
            name
        } = req.body;

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

        const lastRecord = await Record.findOne({
            collectionName: new mongoose.Types.ObjectId(collectionId as string)
        }).sort({
            position: -1
        });

        const record = await Record.create({

            workspace: moduleItem.workspace,

            module: collection.module,

            collectionName: new mongoose.Types.ObjectId(collectionId as string),

            name,

            position: lastRecord ? lastRecord.position + 1 : 0,

            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)

        });

        await touchWorkspace(moduleItem.workspace);

        res.status(201).json({

            message: "Record created successfully",

            record

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }
};



export const getCollectionRecords = async (req: Request, res: Response) => {

    try {

        const { collectionId } = req.params;

        const records = await Record.find({

            collectionName: new mongoose.Types.ObjectId(collectionId as string),

            isArchived: false

        }).sort({

            position: 1

        });

        res.status(200).json({

            records

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }

};



export const updateRecord = async (req: Request, res: Response) => {

    try {

        const { recordId } = req.params;

        const record = await Record.findByIdAndUpdate(

            recordId,

            req.body,

            {
                new: true
            }

        );

        if (!record) {

            return res.status(404).json({

                message: "Record not found"

            });

        }

        await touchWorkspace(record.workspace);

        res.status(200).json({

            message: "Record updated successfully",

            record

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }

};



export const deleteRecord = async (req: Request, res: Response) => {

    try {

        const { recordId } = req.params;

        const record = await Record.findByIdAndUpdate(

            recordId,

            {
                isArchived: true
            },

            {
                new: true
            }

        );

        if (!record) {

            return res.status(404).json({

                message: "Record not found"

            });

        }

        await touchWorkspace(record.workspace);

        res.status(200).json({

            message: "Record archived successfully"

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }

};