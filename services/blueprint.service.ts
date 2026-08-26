// services/blueprint.service.ts

import mongoose from "mongoose";

import Workspace from "../models/Workspace";
import WorkspaceMember from "../models/WorkspaceMember";
import Module from "../models/Module";
import Collection from "../models/Collection";
import Column from "../models/Column";
import Record from "../models/Record";

import { touchWorkspace } from "../utils/workspaceHelper";
import { logActivity } from "./activity.service";
import { getMembership } from "./access.service";
import type { AppliedAction } from "./agentTools.service";

/**
 * Whole-structure setup: "set me up a sales CRM" in one authorised press.
 *
 * The model's job is only to WRITE the plan — one tool call, a few hundred
 * tokens. Building it is plain code: no further model calls, so the expensive
 * part happens once and the user is charged for thinking, not for typing out
 * forty create calls.
 *
 * Everything is capped. A model that hallucinates fifty modules should produce
 * a refusal, not fifty modules.
 */

export const BLUEPRINT_LIMITS = {
    modules: 8,
    collectionsPerModule: 12,
    columnsPerModule: 15,
    recordsPerCollection: 25,
    totalWrites: 250
} as const;

export interface BlueprintColumn {
    name: string;
    type: ColumnType;
    labels?: string[];
}

export interface BlueprintModule {
    name: string;
    collections?: string[];
    columns?: BlueprintColumn[];
    records?: { collection: string; names: string[] }[];
}

export interface BlueprintPlan {
    /** Name of a workspace to create; omit to build inside the current one. */
    workspace?: string;
    workspaceId?: string;
    /** Name of the existing workspace being built into, for the preview. */
    existingWorkspaceName?: string;
    modules: BlueprintModule[];
    totals: {
        workspaces: number;
        modules: number;
        collections: number;
        columns: number;
        records: number;
    };
}

const COLUMN_TYPES = [
    "text", "number", "status", "date", "person", "checkbox",
    "email", "phone", "link", "dropdown", "timeline", "file", "rating"
] as const;

type ColumnType = (typeof COLUMN_TYPES)[number];

const asColumnType = (value: string): ColumnType =>
    (COLUMN_TYPES as readonly string[]).includes(value) ? (value as ColumnType) : "text";

const STATUS_COLOURS = ["#94A3B8", "#F59E0B", "#EF4444", "#22C55E", "#6C5CE7"];

const COLLECTION_COLOURS = [
    "#6366F1", "#22C55E", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899"
];

const text = (value: unknown) => String(value ?? "").trim();

/**
 * Turn whatever the model sent into a plan we are willing to execute.
 *
 * Parsing and capping happen here, BEFORE the user is shown anything — so the
 * preview they authorise is exactly what will be built, never an optimistic
 * version of it.
 */
export const parseBlueprint = (
    raw: unknown,
    fallbackWorkspaceId?: string
): BlueprintPlan | null => {

    const input = (raw ?? {}) as Record<string, unknown>;

    /**
     * The model is told to send a NAME here, and sometimes sends the id from
     * CONTEXT instead — which would have created a workspace called
     * "6a8cba26168e34600ff48b16". An id is never a name, so it is read as the
     * target to build into rather than taken literally.
     */
    const rawWorkspace = text(input.newWorkspaceName ?? input.workspace);

    const looksLikeId = /^[a-f0-9]{24}$/i.test(rawWorkspace);

    const workspaceName = looksLikeId ? "" : rawWorkspace;

    const targetWorkspaceId = looksLikeId ? rawWorkspace : fallbackWorkspaceId;

    const rawModules = Array.isArray(input.modules) ? input.modules : [];

    const modules: BlueprintModule[] = [];

    let collections = 0;
    let columns = 0;
    let records = 0;

    for (const entry of rawModules.slice(0, BLUEPRINT_LIMITS.modules)) {
        const moduleInput = (entry ?? {}) as Record<string, unknown>;
        const name = text(moduleInput.name);

        if (!name) continue;

        const moduleCollections = (
            Array.isArray(moduleInput.collections) ? moduleInput.collections : []
        )
            .map(text)
            .filter(Boolean)
            .slice(0, BLUEPRINT_LIMITS.collectionsPerModule);

        const moduleColumns = (
            Array.isArray(moduleInput.columns) ? moduleInput.columns : []
        )
            .map((column) => {
                const columnInput = (column ?? {}) as Record<string, unknown>;
                const columnName = text(columnInput.name);

                if (!columnName) return null;

                return {
                    name: columnName,
                    type: asColumnType(text(columnInput.type)),
                    labels: (Array.isArray(columnInput.labels) ? columnInput.labels : [])
                        .map(text)
                        .filter(Boolean)
                        .slice(0, 8)
                } as BlueprintColumn;
            })
            .filter((column): column is BlueprintColumn => column !== null)
            .slice(0, BLUEPRINT_LIMITS.columnsPerModule);

        const moduleRecords = (
            Array.isArray(moduleInput.records) ? moduleInput.records : []
        )
            .map((group) => {
                const groupInput = (group ?? {}) as Record<string, unknown>;

                return {
                    collection: text(groupInput.collection),
                    names: (Array.isArray(groupInput.names) ? groupInput.names : [])
                        .map(text)
                        .filter(Boolean)
                        .slice(0, BLUEPRINT_LIMITS.recordsPerCollection)
                };
            })
            .filter((group) => group.collection && group.names.length > 0);

        collections += moduleCollections.length;
        columns += moduleColumns.length;
        records += moduleRecords.reduce((sum, group) => sum + group.names.length, 0);

        modules.push({
            name,
            collections: moduleCollections,
            columns: moduleColumns,
            records: moduleRecords
        });
    }

    if (modules.length === 0 && !workspaceName) return null;

    const workspaces = workspaceName ? 1 : 0;

    // One more guard for the pathological case: lots of small modules.
    if (workspaces + modules.length + collections + columns + records >
        BLUEPRINT_LIMITS.totalWrites) {
        return null;
    }

    return {
        workspace: workspaceName || undefined,
        workspaceId: workspaceName ? undefined : targetWorkspaceId,
        modules,
        totals: { workspaces, modules: modules.length, collections, columns, records }
    };
};

/** The one-line summary shown above the authorise button. */
export const describeBlueprint = (plan: BlueprintPlan) => {
    const { totals } = plan;

    const parts = [
        totals.workspaces ? `${totals.workspaces} workspace` : "",
        totals.modules ? `${totals.modules} module${totals.modules === 1 ? "" : "s"}` : "",
        totals.collections
            ? `${totals.collections} collection${totals.collections === 1 ? "" : "s"}`
            : "",
        totals.columns ? `${totals.columns} column${totals.columns === 1 ? "" : "s"}` : "",
        totals.records ? `${totals.records} record${totals.records === 1 ? "" : "s"}` : ""
    ].filter(Boolean);

    return `Create ${parts.join(", ")}`;
};

export interface BlueprintResult {
    applied: AppliedAction[];
    workspaceId: string;
    summary: string;
}

/**
 * Build the plan. Called only from the authorised path, never from the model
 * loop — see the ExecuteOptions note in agentTools.service.ts.
 */
export const buildBlueprint = async (
    plan: BlueprintPlan,
    userId: string
): Promise<BlueprintResult> => {

    const applied: AppliedAction[] = [];

    let workspaceId = plan.workspaceId ?? "";

    // ---------------------------------------------------------- workspace
    if (plan.workspace) {
        const slug = `${plan.workspace
            .toLowerCase()
            .replace(/[^\w\s-]/g, "")
            .replace(/[\s_-]+/g, "-")
            .replace(/^-+|-+$/g, "")}-${Math.random().toString(36).slice(2, 6)}`;

        const workspace = await Workspace.create({
            name: plan.workspace,
            slug,
            owner: userId
        });

        await WorkspaceMember.create({
            workspace: workspace._id,
            user: userId,
            role: "owner"
        });

        workspaceId = String(workspace._id);

        applied.push({
            tool: "create_blueprint",
            kind: "workspace",
            id: workspaceId,
            name: workspace.name
        });
    }

    if (!workspaceId) {
        throw new Error("No workspace to build in — name one, or open one first.");
    }

    // Building inside an existing workspace still requires membership.
    if (!plan.workspace) {
        const membership = await getMembership(workspaceId, userId);
        if (!membership) {
            throw new Error("You are not a member of that workspace");
        }
    }

    const workspaceOid = new mongoose.Types.ObjectId(workspaceId);
    const userOid = new mongoose.Types.ObjectId(userId);

    // ------------------------------------------------------------ modules
    for (const blueprintModule of plan.modules) {
        const moduleItem = await Module.create({
            workspace: workspaceOid,
            name: blueprintModule.name,
            visibility: "workspace",
            createdBy: userOid
        });

        applied.push({
            tool: "create_blueprint",
            kind: "module",
            id: String(moduleItem._id),
            name: moduleItem.name,
            color: moduleItem.color
        });

        await logActivity({
            workspace: workspaceId,
            user: userId,
            action: "module_created",
            module: moduleItem._id,
            targetName: moduleItem.name,
            after: moduleItem.name,
            message: `created module "${moduleItem.name}" via Aquiline`
        });

        // -------------------------------------------------------- columns
        let columnPosition = 0;

        for (const column of blueprintModule.columns ?? []) {
            const statusOptions =
                column.type === "status" && column.labels?.length
                    ? column.labels.map((label, index) => ({
                        label,
                        color: STATUS_COLOURS[index % STATUS_COLOURS.length]
                    }))
                    : undefined;

            const created = await Column.create({
                module: moduleItem._id,
                name: column.name,
                type: column.type,
                statusOptions,
                position: columnPosition++,
                createdBy: userOid
            });

            applied.push({
                tool: "create_blueprint",
                kind: "column",
                id: String(created._id),
                name: created.name
            });
        }

        // ---------------------------------------------------- collections
        const collectionIds = new Map<string, mongoose.Types.ObjectId>();

        let collectionPosition = 0;

        for (const collectionName of blueprintModule.collections ?? []) {
            const created = await Collection.create({
                module: moduleItem._id,
                name: collectionName,
                color: COLLECTION_COLOURS[collectionPosition % COLLECTION_COLOURS.length],
                position: collectionPosition++,
                createdBy: userOid
            });

            collectionIds.set(collectionName.toLowerCase(), created._id as mongoose.Types.ObjectId);

            applied.push({
                tool: "create_blueprint",
                kind: "collection",
                id: String(created._id),
                name: created.name,
                color: created.color
            });
        }

        // -------------------------------------------------------- records
        for (const group of blueprintModule.records ?? []) {
            const collectionId = collectionIds.get(group.collection.toLowerCase());

            // A record with nowhere to live is skipped, not guessed at.
            if (!collectionId) continue;

            let recordPosition = 0;

            for (const recordName of group.names) {
                const record = await Record.create({
                    workspace: workspaceOid,
                    module: moduleItem._id,
                    collectionName: collectionId,
                    name: recordName,
                    position: recordPosition++,
                    createdBy: userOid
                });

                applied.push({
                    tool: "create_blueprint",
                    kind: "record",
                    id: String(record._id),
                    name: record.name
                });
            }
        }
    }

    await touchWorkspace(workspaceId);

    return {
        applied,
        workspaceId,
        summary: describeBlueprint(plan)
    };
};
