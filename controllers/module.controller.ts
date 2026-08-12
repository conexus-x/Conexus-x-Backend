import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import { Request, Response } from "express";
import Module from "../models/Module";
import { touchWorkspace } from "../utils/workspaceHelper";


export const createModule = async (
    req: AuthRequest,
    res: Response
) => {


    try {
        const { workspaceId } = req.params;
        const { name, description, icon, color, visibility } = req.body;

        const moduleItem = await Module.create({
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
            message: "Module created successfully",
            module: moduleItem
        });
    }
    catch (error: any) {
        res.status(500).json({ message: error.message });
    }


};




export const getWorkspaceModules = async (req: Request, res: Response) => {
    try {
        const { workspaceId } = req.params;
        const modules = await Module.find({
            workspace: new mongoose.Types.ObjectId(workspaceId as string),
            isArchived: false
        })
            .populate("createdBy", "name email"); res.json({ modules });
    }
    catch (error: any) {

        res.status(500).json({ message: error.message });
    }
};


export const deleteModule = async (req: AuthRequest, res: Response) => {
    try {
        const { moduleId } = req.params;
        const moduleItem = await Module.findById(moduleId);
        if (!moduleItem) {
            return res.status(404).json({ message: "Module not found" });
        }
        await Module.deleteOne({ _id: moduleId });
        await touchWorkspace(moduleItem.workspace);
        res.json({ message: "Module deleted successfully" });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

