import { Request, Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import ItemValue from "../models/ItemValue";
import { touchWorkspace } from "../utils/workspaceHelper";

export const createItemValue = async (req: AuthRequest, res: Response) => {
    try {

        const {
            workspace,
            board,
            group,
            item,
            column,
            value
        } = req.body;

        const exists = await ItemValue.findOne({
            item: new mongoose.Types.ObjectId(item as string),
            column: new mongoose.Types.ObjectId(column as string)
        });

        if (exists) {
            return res.status(400).json({
                message: "Value already exists"
            });
        }

        const itemValue = await ItemValue.create({

            workspace: new mongoose.Types.ObjectId(workspace as string),

            board: new mongoose.Types.ObjectId(board as string),

            group: new mongoose.Types.ObjectId(group as string),

            item: new mongoose.Types.ObjectId(item as string),

            column: new mongoose.Types.ObjectId(column as string),

            value,

            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)

        });

        await touchWorkspace(workspace);

        res.status(201).json({

            message: "Value created successfully",

            itemValue

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }
};

export const getItemValues = async (req: Request, res: Response) => {

    try {

        const { itemId } = req.params;

        const values = await ItemValue.find({

            item: new mongoose.Types.ObjectId(itemId as string)

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

export const updateItemValue = async (req: Request, res: Response) => {

    try {

        const { itemValueId } = req.params;

        const { value } = req.body;

        const itemValue = await ItemValue.findByIdAndUpdate(

            itemValueId,

            {
                value
            },

            {
                new: true
            }

        );

        if (!itemValue) {

            return res.status(404).json({

                message: "Item value not found"

            });

        }

        await touchWorkspace(itemValue.workspace);

        res.status(200).json({

            message: "Value updated successfully",

            itemValue

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }

};

export const deleteItemValue = async (req: Request, res: Response) => {

    try {

        const { itemValueId } = req.params;

        const itemValue = await ItemValue.findByIdAndDelete(

            itemValueId

        );

        if (!itemValue) {

            return res.status(404).json({

                message: "Item value not found"

            });

        }

        await touchWorkspace(itemValue.workspace);

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