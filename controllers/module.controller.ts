import mongoose from "mongoose";
import { paginationMeta, parsePagination, parseSort } from "../utils/pagination";
import { accessibleModuleFilter, getMembership, isWorkspaceManager } from "../services/access.service";
import { AuthRequest } from "./wrokspace.controller";
import { Request, Response } from "express";
import Module from "../models/Module";
import Record from "../models/Record";
import { touchWorkspace } from "../utils/workspaceHelper";
import { logActivity } from "../services/activity.service";
import { effectiveStatus } from "../services/presence.service";
import type { UserStatus } from "../models/User";


/**
 * Tags are user-typed, so they are normalised before they are stored.
 *
 * Trimmed and de-duplicated CASE-INSENSITIVELY, because "Client" and "client"
 * are one tag to a person and two to a database — and a filter that misses half
 * the rows is worse than no filter. First spelling wins, so the casing someone
 * chose is what they see back. Capped so a paste cannot turn one module into a
 * thousand-label document.
 *
 * The colour is validated as a hex literal rather than trusted: it is written
 * straight into a style attribute on the client, so anything else is a value
 * that could not be rendered anyway.
 */
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 24;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FALLBACK_TAG_COLOR = "#94A3B8";

function sanitiseTags(input: unknown): { label: string; color: string }[] | undefined {
    if (!Array.isArray(input)) return undefined;

    const seen = new Set<string>();
    const tags: { label: string; color: string }[] = [];

    for (const raw of input) {
        // Accepts a bare string too, so anything written before tags had
        // colours still round-trips instead of being dropped.
        const source =
            typeof raw === "string"
                ? { label: raw, color: FALLBACK_TAG_COLOR }
                : (raw as { label?: unknown; color?: unknown } | null);

        if (!source || typeof source.label !== "string") continue;

        const label = source.label.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
        if (!label) continue;

        const key = label.toLowerCase();
        if (seen.has(key)) continue;

        const color =
            typeof source.color === "string" && HEX_COLOR.test(source.color.trim())
                ? source.color.trim()
                : FALLBACK_TAG_COLOR;

        seen.add(key);
        tags.push({ label, color });

        if (tags.length >= MAX_TAGS) break;
    }

    return tags;
}

export const createModule = async (
    req: AuthRequest,
    res: Response
) => {


    try {
        const { workspaceId } = req.params;
        const { name, description, icon, color, visibility } = req.body;
        const tags = sanitiseTags(req.body.tags);

        const moduleItem = await Module.create({
            workspace: new mongoose.Types.ObjectId(workspaceId as string),
            name,
            description,
            icon,
            color,
            visibility,
            tags: tags ?? [],
            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)

        });

        await touchWorkspace(workspaceId as string);

        await logActivity({
            workspace: String(workspaceId),
            user: req.user?.id,
            action: "module_created",
            module: moduleItem._id,
            targetName: moduleItem.name,
            after: moduleItem.name,
            message: `created module "${moduleItem.name}"`
        });

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
        // Sub-records are not rows on the board, so they are not counted as
        // records on the card either — `parentRecord: null` also matches the
        // rows written before that field existed.
        { $match: { module: { $in: moduleIds }, isArchived: false, parentRecord: null } },
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


/**
 * Turns a populated creator into the shape the client may see.
 *
 * `presence` is derived on read and the raw `status`/`lastSeen` are dropped:
 * the picked status is private (someone set to "appear offline" must look
 * offline), and lastSeen is a movement log nobody outside the server needs.
 */
function publicCreator(createdBy: unknown) {
    if (!createdBy || typeof createdBy !== "object") return createdBy;

    const { status, lastSeen, ...rest } = createdBy as Record<string, unknown> & {
        status?: UserStatus;
        lastSeen?: Date;
    };

    return { ...rest, presence: effectiveStatus({ status, lastSeen }) };
}

export const getWorkspaceModules = async (req: AuthRequest, res: Response) => {
    try {
        const { workspaceId } = req.params;

        const userId = String(req.user?.id ?? "");

        const membership = await getMembership(String(workspaceId), userId);

        /**
         * The list is the first place board access shows up: a private board the
         * caller was not granted must not even appear. Everything below runs on
         * this filter, so the count and the stats match what was returned.
         */
        const filter = await accessibleModuleFilter(
            userId,
            String(workspaceId),
            membership?.role
        );

        if (!filter) {
            return res.json({ modules: [] });
        }

        const pagination = parsePagination(req.query);
        const sort = parseSort(
            req.query,
            ["name", "createdAt", "updatedAt"],
            { createdAt: 1 }
        );

        const query = Module.find(filter)
            .sort(sort)
            // The User model has no `name` field — selecting it left every card
            // showing "Unknown User" with no avatar.
            // status + lastSeen are fetched only to DERIVE presence below and
            // are stripped before the response — the raw pick must never leave
            // the server, or "appear offline" would leak. Same rule as
            // getWorkspaceMembers.
            .populate("createdBy", "firstName lastName email avatar status lastSeen")
            .lean();

        if (pagination.enabled) {
            query.skip(pagination.skip).limit(pagination.limit);
        }

        const modules = await query;

        const stats = await buildModuleStats(modules.map((m) => m._id));

        const withStats = modules.map((moduleItem) => ({
            ...moduleItem,
            createdBy: publicCreator(moduleItem.createdBy),
            ...(stats.get(moduleItem._id.toString()) ?? {
                totalRecords: 0,
                completedRecords: 0,
                performance: 0,
                graphData: []
            })
        }));

        if (!pagination.enabled) {
            return res.json({ modules: withStats });
        }

        res.json({
            modules: withStats,
            pagination: paginationMeta(
                await Module.countDocuments(filter),
                pagination
            )
        });
    }
    catch (error: any) {

        res.status(500).json({ message: error.message });
    }
};


const VISIBILITIES = ["private", "workspace", "public"] as const;

type Visibility = (typeof VISIBILITIES)[number];


/**
 * PUT /api/modules/:moduleId
 *
 * Board settings. Access to the board itself is already checked by
 * requireModuleAccess on the route; the extra rule here is that VISIBILITY is
 * the lever that decides who can open the board, so only an owner or admin may
 * pull it. Everyone with board access can still rename or restyle it.
 */
export const updateModule = async (req: AuthRequest, res: Response) => {
    try {
        const { moduleId } = req.params;

        const moduleItem = await Module.findById(moduleId);

        if (!moduleItem) {
            return res.status(404).json({ message: "Module not found" });
        }

        const { name, description, icon, color, visibility } = req.body;
        const tags = sanitiseTags(req.body.tags);

        if (visibility !== undefined) {
            if (!VISIBILITIES.includes(visibility)) {
                return res.status(400).json({
                    message: `Visibility must be one of: ${VISIBILITIES.join(", ")}`
                });
            }

            const membership = await getMembership(
                String(moduleItem.workspace),
                String(req.user?.id)
            );

            if (!isWorkspaceManager(membership?.role)) {
                return res.status(403).json({
                    message: "Only an owner or admin can change who can see a board"
                });
            }
        }

        // Captured before the write so the audit row can show the change.
        const before = {
            name: moduleItem.name,
            visibility: moduleItem.visibility
        };

        if (typeof name === "string" && name.trim()) moduleItem.name = name.trim();
        if (typeof description === "string") moduleItem.description = description;
        if (typeof icon === "string") moduleItem.icon = icon;
        if (typeof color === "string") moduleItem.color = color;
        if (visibility !== undefined) moduleItem.visibility = visibility as Visibility;
        // `undefined` means "not sent"; an empty array means "clear them".
        if (tags !== undefined) moduleItem.tags = tags;

        await moduleItem.save();

        await touchWorkspace(moduleItem.workspace);

        const changedVisibility =
            visibility !== undefined && visibility !== before.visibility;

        await logActivity({
            workspace: moduleItem.workspace,
            user: req.user?.id,
            module: moduleItem._id,
            action: "module_updated",
            targetName: moduleItem.name,
            before: changedVisibility ? before.visibility : before.name,
            after: changedVisibility ? moduleItem.visibility : moduleItem.name,
            message: changedVisibility
                ? `made "${moduleItem.name}" ${moduleItem.visibility === "private" ? "private" : `visible to the ${moduleItem.visibility}`}`
                : `updated board "${moduleItem.name}"`
        });

        return res.json({ message: "Module updated", module: moduleItem });
    }
    catch (error: any) {

        console.error("Update module error:", error.message);

        return res.status(500).json({ message: error.message });
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

        await logActivity({
            workspace: moduleItem.workspace,
            user: req.user?.id,
            action: "module_deleted",
            targetName: moduleItem.name,
            before: moduleItem.name,
            after: null,
            message: `deleted module "${moduleItem.name}"`
        });

        res.json({ message: "Module deleted successfully" });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

