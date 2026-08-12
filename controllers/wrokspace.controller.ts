import { Request, Response } from "express";
import Workspace from "../models/Workspace";
import WorkspaceMember from "../models/WorkspaceMember";
import mongoose from "mongoose";
import Module from "../models/Module";
import Column from "../models/Column";
import Record from "../models/Record";
import Collection from "../models/Collection";
import Activity from "../models/Activity";
import Comment from "../models/Comment";
import File from "../models/File";
import Notification from "../models/Notification";
import { touchWorkspace } from "../utils/workspaceHelper";

// Extend Request type to include user information from auth middleware
export interface AuthRequest extends Request {
    user?: {
        id: string;
        [key: string]: any;
    };
}

// Create Workspace
export const createWorkspace = async (req: AuthRequest, res: Response) => {
    try {
        const { name } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                message: "Unauthorized: User not found in request"
            });
        }

        // Generate a URL-friendly unique slug (required by Workspace schema)
        const baseSlug = name
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, "") // remove non-alphanumeric chars except space and hyphen
            .replace(/[\s_-]+/g, "-")  // replace spaces/underscores with a single hyphen
            .replace(/^-+|-+$/g, "");  // trim leading/trailing hyphens
        
        const slug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;

        const workspace = await Workspace.create({
            name,
            slug,
            owner: userId
        });

        await WorkspaceMember.create({
            workspace: workspace._id,
            user: userId,
            role: "owner"
        });

        return res.status(201).json({
            message: "Workspace created successfully",
            workspace
        });
    } catch (error: any) {
        return res.status(500).json({
            message: error.message
        });
    }
};

// Get All User Workspaces
export const getWorkspaces = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                message: "Unauthorized: User not found in request"
            });
        }

        const memberships = await WorkspaceMember.find({
            user: userId
        }).populate("workspace");

        // Collect workspace IDs and count modules for each
        const workspaceIds = memberships
            .map((m: any) => m.workspace?._id)
            .filter(Boolean);

        const moduleCounts = await Module.aggregate([
            { $match: { workspace: { $in: workspaceIds } } },
            { $group: { _id: "$workspace", count: { $sum: 1 } } }
        ]);

        const countMap: Record<string, number> = {};
        for (const entry of moduleCounts) {
            countMap[entry._id.toString()] = entry.count;
        }

        // Attach totalModules to each membership's workspace
        const workspaces = memberships.map((m: any) => {
            const ws = m.workspace?.toObject ? m.workspace.toObject() : m.workspace;
            return {
                ...m.toObject(),
                workspace: ws
                    ? { ...ws, totalModules: countMap[ws._id?.toString()] || 0 }
                    : ws,
            };
        });

        return res.json({
            workspaces
        });
    } catch (error: any) {
        return res.status(500).json({
            message: error.message
        });
    }
};

// Get Single Workspace
export const getWorkspace = async (req: Request, res: Response) => {
    try {
        const workspace = await Workspace.findById(req.params.id);

        if (!workspace) {
            return res.status(404).json({
                message: "Workspace not found"
            });
        }

        return res.json({
            workspace
        });
    } catch (error: any) {
        return res.status(500).json({
            message: error.message
        });
    }
};

// Update Workspace
export const updateWorkspace = async (req: Request, res: Response) => {
    try {
        const workspace = await Workspace.findByIdAndUpdate(
            req.params.id,
            {
                name: req.body.name
            },
            {
                new: true
            }
        );

        if (workspace) {
            await touchWorkspace(workspace._id);
        }

        return res.json({
            message: "Workspace updated",
            workspace
        });
    } catch (error: any) {
        return res.status(500).json({
            message: error.message
        });
    }
};

// Delete Workspace
export const deleteWorkspace = async (req: Request, res: Response) => {
        try {
            const workspaceId = req.params.id;
            // Start transaction
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                // Delete related data
                // Modules belonging to workspace
                const modules = await Module.find({ workspace: workspaceId }).session(session);
                const moduleIds = modules.map(b => b._id);

                // Delete records, collections, columns, activities, comments, files, notifications
                await Record.deleteMany({ workspace: workspaceId }).session(session);
                await Collection.deleteMany({ module: { $in: moduleIds } }).session(session);
                await Column.deleteMany({ module: { $in: moduleIds } }).session(session);
                await Activity.deleteMany({ workspace: workspaceId }).session(session);
                await Comment.deleteMany({ workspace: workspaceId }).session(session);
                await File.deleteMany({ workspace: workspaceId }).session(session);
                await Notification.deleteMany({ workspace: workspaceId }).session(session);

                // Delete modules
                await Module.deleteMany({ workspace: workspaceId }).session(session);

                // Delete workspace members
                await WorkspaceMember.deleteMany({ workspace: workspaceId }).session(session);

                // Finally delete workspace
                await Workspace.findByIdAndDelete(workspaceId).session(session);

                await session.commitTransaction();
                session.endSession();
                return res.json({ message: "Workspace and related data deleted" });
            } catch (innerErr) {
                await session.abortTransaction();
                session.endSession();
                throw innerErr;
            }
        } catch (error: any) {
            return res.status(500).json({ message: error.message });
        }
    };
