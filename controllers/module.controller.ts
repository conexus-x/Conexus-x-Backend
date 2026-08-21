import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import { Request, Response } from "express";
import Module from "../models/Module";
import Record from "../models/Record";
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




// How many days of history the card's sparkline shows.
const TREND_DAYS = 16;

interface ModuleStats {
    totalRecords: number;
    completedRecords: number;
    performance: number;
    graphData: { day: string; value: number }[];
}

/**
 * Stats for every module in the workspace in ONE aggregation, rather than a
 * count per card. The $match on `module` rides the existing
 * { module, collectionName, position } index, and $facet means the totals and
 * the daily trend share a single pass over the matched records.
 */
const buildModuleStats = async (
    moduleIds: mongoose.Types.ObjectId[]
): Promise<Map<string, ModuleStats>> => {

    const stats = new Map<string, ModuleStats>();

    if (moduleIds.length === 0) return stats;

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (TREND_DAYS - 1));

    const [result] = await Record.aggregate([
        { $match: { module: { $in: moduleIds }, isArchived: false } },
        {
            $facet: {
                totals: [
                    {
                        $group: {
                            _id: "$module",
                            total: { $sum: 1 },
                            completed: {
                                $sum: { $cond: [{ $eq: ["$isCompleted", true] }, 1, 0] }
                            }
                        }
                    }
                ],
                daily: [
                    { $match: { createdAt: { $gte: since } } },
                    {
                        $group: {
                            _id: {
                                module: "$module",
                                day: {
                                    $dateToString: {
                                        format: "%Y-%m-%d",
                                        date: "$createdAt"
                                    }
                                }
                            },
                            count: { $sum: 1 }
                        }
                    }
                ]
            }
        }
    ]);

    const totals = (result?.totals ?? []) as {
        _id: mongoose.Types.ObjectId;
        total: number;
        completed: number;
    }[];

    const daily = (result?.daily ?? []) as {
        _id: { module: mongoose.Types.ObjectId; day: string };
        count: number;
    }[];

    // The trend needs a zero for every quiet day, so build the axis up front.
    const axis: string[] = [];
    for (let i = 0; i < TREND_DAYS; i++) {
        const d = new Date(since);
        d.setUTCDate(d.getUTCDate() + i);
        axis.push(d.toISOString().slice(0, 10));
    }

    const countsByModule = new Map<string, Map<string, number>>();

    daily.forEach((row) => {
        const key = row._id.module.toString();
        const byDay = countsByModule.get(key) ?? new Map<string, number>();
        byDay.set(row._id.day, row.count);
        countsByModule.set(key, byDay);
    });

    moduleIds.forEach((id) => {
        const key = id.toString();
        const totalRow = totals.find((t) => t._id.toString() === key);
        const total = totalRow?.total ?? 0;
        const completed = totalRow?.completed ?? 0;
        const byDay = countsByModule.get(key);

        stats.set(key, {
            totalRecords: total,
            completedRecords: completed,
            performance: total > 0 ? Math.round((completed / total) * 100) : 0,
            graphData: axis.map((day) => ({ day, value: byDay?.get(day) ?? 0 }))
        });
    });

    return stats;
};


export const getWorkspaceModules = async (req: Request, res: Response) => {
    try {
        const { workspaceId } = req.params;

        const modules = await Module.find({
            workspace: new mongoose.Types.ObjectId(workspaceId as string),
            isArchived: false
        })
            // The User model has no `name` field — selecting it left every card
            // showing "Unknown User" with no avatar.
            .populate("createdBy", "firstName lastName email avatar")
            .lean();

        const stats = await buildModuleStats(modules.map((m) => m._id));

        res.json({
            modules: modules.map((moduleItem) => ({
                ...moduleItem,
                ...(stats.get(moduleItem._id.toString()) ?? {
                    totalRecords: 0,
                    completedRecords: 0,
                    performance: 0,
                    graphData: []
                })
            }))
        });
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

