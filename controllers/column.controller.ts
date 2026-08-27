import { Request, Response } from "express";
import mongoose from "mongoose";
import { paginationMeta, parsePagination, parseSort } from "../utils/pagination";
import { AuthRequest } from "./wrokspace.controller";
import Column from "../models/Column";
import Module from "../models/Module";
import { touchModule, touchWorkspace } from "../utils/workspaceHelper";
import { logActivity } from "../services/activity.service";
import { emitChange, originOf } from "../services/realtime.service";

/**
 * Columns for one grid of a module.
 *
 * A board's own columns predate `scope`, so they are matched as "anything that
 * is not a sub-record column" — an equality match on "record" would hide every
 * column created before this field existed.
 */
export const scopeFilter = (scope?: unknown) =>
    String(scope) === "subrecord"
        ? { scope: "subrecord" as const }
        : { scope: { $ne: "subrecord" as const } };


export const createColumn = async(req:AuthRequest,res:Response)=>{

    try{
        const {moduleId}=req.params;
        const { name,type,options,statusOptions,settings,width,position,isRequired,isHidden,scope }=req.body;
        let initialStatusOptions = statusOptions;
        if (type === "status" && (!initialStatusOptions || initialStatusOptions.length === 0)) {
            initialStatusOptions = [
                { label: "Not Started", color: "#94A3B8" },
                { label: "Working on it", color: "#F59E0B" },
                { label: "Stuck", color: "#EF4444" },
                { label: "Done", color: "#22C55E" },
            ];
        }
        const column=await Column.create({
             module: new mongoose.Types.ObjectId(moduleId as string),name,
            type,options,statusOptions: initialStatusOptions,settings,width,position,isRequired,isHidden,
            scope: scope === "subrecord" ? "subrecord" : "record",
            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)
        });

        const moduleItem = await Module.findById(moduleId);
        if (moduleItem) {
            await touchWorkspace(moduleItem.workspace);
            await touchModule(moduleItem._id);

            await logActivity({
                workspace: moduleItem.workspace,
                user: req.user?.id,
                action: "column_created",
                module: String(moduleId),
                column: column._id,
                targetName: column.name,
                after: column.name,
                message: `added ${type || "text"} ${column.scope === "subrecord" ? "sub-record " : ""}column "${column.name}"`
            });
        }
        emitChange({
            entity: "column",
            action: "created",
            id: String(column._id),
            workspaceId: moduleItem ? String(moduleItem.workspace) : undefined,
            moduleId: String(moduleId),
            columnId: String(column._id),
            scope: column.scope,
            data: column,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(201).json({
            message:"Column created successfully",column
        });

    }
    catch(error:any){
        res.status(500).json({message:error.message});
    }

};



export const getModuleColumns = async(req:Request,res:Response)=>{

    try{
        const {moduleId}=req.params;

        // ?scope=subrecord asks for the sub-record grid; anything else is the board.
        const filter = {
            module: new mongoose.Types.ObjectId(moduleId as string),
            ...scopeFilter(req.query.scope)
        };

        const pagination = parsePagination(req.query);
        const sort = parseSort(
            req.query,
            ["position", "name", "type", "createdAt"],
            { position: 1 }
        );

        const query = Column.find(filter).sort(sort);

        if (pagination.enabled) {
            query.skip(pagination.skip).limit(pagination.limit);
        }

        const columns = await query;

        if (!pagination.enabled) {
            return res.status(200).json({ columns });
        }

        res.status(200).json({
            columns,
            pagination: paginationMeta(
                await Column.countDocuments(filter),
                pagination
            )
        });

    }
    catch(error:any){
        res.status(500).json({message:error.message});
    }
};


export const updateColumn = async(req:AuthRequest,res:Response)=>{

    try{
        const {columnId}=req.params;

        // Captured before the write — findByIdAndUpdate returns the new doc.
        const previous = await Column.findById(columnId);

        const column=await Column.findByIdAndUpdate(
            columnId,
            req.body,

            {
                new:true
            }

        );


        if(!column){

            return res.status(404).json({

                message:"Column not found"

            });

        }

        const moduleItem = await Module.findById(column.module);
        if (moduleItem) {
            await touchWorkspace(moduleItem.workspace);
            await touchModule(moduleItem._id);

            if (previous && previous.name !== column.name) {
                await logActivity({
                    workspace: moduleItem.workspace,
                    user: req.user?.id,
                    action: "column_updated",
                    module: column.module,
                    column: column._id,
                    targetName: column.name,
                    before: previous.name,
                    after: column.name,
                    message: `renamed column "${previous.name}" to "${column.name}"`
                });
            }
        }


        emitChange({
            entity: "column",
            action: "updated",
            id: String(column._id),
            workspaceId: moduleItem ? String(moduleItem.workspace) : undefined,
            moduleId: String(column.module),
            columnId: String(column._id),
            scope: column.scope,
            data: column,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(200).json({

            message:"Column updated successfully",
            column

        });

    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }

};



export const deleteColumn = async(req:AuthRequest,res:Response)=>{

    try{

        const {columnId}=req.params;


        const column=await Column.findByIdAndDelete(columnId);


        if(!column){

            return res.status(404).json({

                message:"Column not found"

            });

        }

        const moduleItem = await Module.findById(column.module);
        if (moduleItem) {
            await touchWorkspace(moduleItem.workspace);
            await touchModule(moduleItem._id);

            await logActivity({
                workspace: moduleItem.workspace,
                user: req.user?.id,
                action: "column_deleted",
                module: column.module,
                targetName: column.name,
                before: column.name,
                after: null,
                message: `deleted column "${column.name}"`
            });
        }


        emitChange({
            entity: "column",
            action: "deleted",
            id: String(column._id),
            workspaceId: moduleItem ? String(moduleItem.workspace) : undefined,
            moduleId: String(column.module),
            columnId: String(column._id),
            scope: column.scope,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(200).json({

            message:"Column deleted successfully"

        });

    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }

};