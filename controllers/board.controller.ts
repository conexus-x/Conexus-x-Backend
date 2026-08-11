import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import { Request, Response } from "express";
import Board from "../models/Board";
import { touchWorkspace } from "../utils/workspaceHelper";


export const createBoard = async (
    req: AuthRequest,
    res: Response
) => {


    try {
        const { workspaceId } = req.params;
        const { name, description, icon, color, visibility } = req.body;

        const board = await Board.create({
            workspace: new mongoose.Types.ObjectId(workspaceId as string),
            name,
            description,
            icon,
            color,
            visibility,
            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)

        });

        await touchWorkspace(workspaceId as string);
        res.status(201).json({
            message: "Board created successfully",
            board
        });
    }
    catch (error: any) {
        res.status(500).json({ message: error.message });
    }


};




export const getWorkspaceBoards = async (req: Request, res: Response) => {
    try {
        const { workspaceId } = req.params;
        const boards = await Board.find({
            workspace: new mongoose.Types.ObjectId(workspaceId as string),
            isArchived: false
        })
            .populate("createdBy", "name email"); res.json({ boards });
    }
    catch (error: any) {

        res.status(500).json({ message: error.message });
    }
};


export const deleteBoard = async (req: AuthRequest, res: Response) => {
    try {
        const { boardId } = req.params;
        const board = await Board.findById(boardId);
        if (!board) {
            return res.status(404).json({ message: "Board not found" });
        }
        await Board.deleteOne({ _id: boardId });
        await touchWorkspace(board.workspace);
        res.json({ message: "Board deleted successfully" });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};
