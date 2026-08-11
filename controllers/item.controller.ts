import { Request, Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import Item from "../models/Item";
import Group from "../models/Group";
import Board from "../models/Board";
import { touchWorkspace } from "../utils/workspaceHelper";

export const createItem = async (req: AuthRequest, res: Response) => {
    try {

        const { groupId } = req.params;

        const {
            name
        } = req.body;

        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({
                message: "Group not found"
            });
        }

        const board = await Board.findById(group.board);

        if (!board) {
            return res.status(404).json({
                message: "Board not found"
            });
        }

        const lastItem = await Item.findOne({
            group: new mongoose.Types.ObjectId(groupId as string)
        }).sort({
            position: -1
        });

        const item = await Item.create({

            workspace: board.workspace,

            board: group.board,

            group: new mongoose.Types.ObjectId(groupId as string),

            name,

            position: lastItem ? lastItem.position + 1 : 0,

            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)

        });

        await touchWorkspace(board.workspace);

        res.status(201).json({

            message: "Item created successfully",

            item

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }
};



export const getGroupItems = async (req: Request, res: Response) => {

    try {

        const { groupId } = req.params;

        const items = await Item.find({

            group: new mongoose.Types.ObjectId(groupId as string),

            isArchived: false

        }).sort({

            position: 1

        });

        res.status(200).json({

            items

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }

};



export const updateItem = async (req: Request, res: Response) => {

    try {

        const { itemId } = req.params;

        const item = await Item.findByIdAndUpdate(

            itemId,

            req.body,

            {
                new: true
            }

        );

        if (!item) {

            return res.status(404).json({

                message: "Item not found"

            });

        }

        await touchWorkspace(item.workspace);

        res.status(200).json({

            message: "Item updated successfully",

            item

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }

};



export const deleteItem = async (req: Request, res: Response) => {

    try {

        const { itemId } = req.params;

        const item = await Item.findByIdAndUpdate(

            itemId,

            {
                isArchived: true
            },

            {
                new: true
            }

        );

        if (!item) {

            return res.status(404).json({

                message: "Item not found"

            });

        }

        await touchWorkspace(item.workspace);

        res.status(200).json({

            message: "Item archived successfully"

        });

    }
    catch (error: any) {

        res.status(500).json({

            message: error.message

        });

    }

};