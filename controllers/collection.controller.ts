import { Request, Response } from "express";
import mongoose from "mongoose";
import { paginationMeta, parsePagination, parseSort } from "../utils/pagination";
import { AuthRequest } from "./wrokspace.controller";
import Collection from "../models/Collection";
import Module from "../models/Module";
import { touchModule, touchWorkspace } from "../utils/workspaceHelper";
import { logActivity } from "../services/activity.service";
import { emitChange, originOf } from "../services/realtime.service";


export const createCollection = async(req:AuthRequest,res:Response)=>{

    try{

        const {moduleId}=req.params;

        const {name,color,position}=req.body;


        const collection=await Collection.create({

            module: new mongoose.Types.ObjectId(moduleId as string),
            name,
            color,
            position:position || 0,
            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)

        });

        const moduleItem = await Module.findById(moduleId);
        if (moduleItem) {
            await touchWorkspace(moduleItem.workspace);
            await touchModule(moduleItem._id);

            await logActivity({
                workspace: moduleItem.workspace,
                user: req.user?.id,
                action: "collection_created",
                module: String(moduleId),
                collectionName: collection._id,
                targetName: collection.name,
                after: collection.name,
                message: `created collection "${collection.name}"`
            });
        }


        emitChange({
            entity: "collection",
            action: "created",
            id: String(collection._id),
            workspaceId: moduleItem ? String(moduleItem.workspace) : undefined,
            moduleId: String(collection.module),
            collectionId: String(collection._id),
            data: collection,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.status(201).json({

            message:"Collection created successfully",
            collection

        });


    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }

};




export const getModuleCollections = async(req:Request,res:Response)=>{

    try{

        const {moduleId}=req.params;


        const filter = {
            module: new mongoose.Types.ObjectId(moduleId as string)
        };

        const pagination = parsePagination(req.query);
        const sort = parseSort(
            req.query,
            ["position", "name", "createdAt", "updatedAt"],
            { position: 1 }
        );

        const query = Collection.find(filter)
            .sort(sort)
            .populate(
                "createdBy",
                "firstName lastName email"
            );

        if (pagination.enabled) {
            query.skip(pagination.skip).limit(pagination.limit);
        }

        const collections = await query;

        if (!pagination.enabled) {
            return res.json({ collections });
        }

        res.json({
            collections,
            pagination: paginationMeta(
                await Collection.countDocuments(filter),
                pagination
            )
        });


    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }

};




export const updateCollection = async(req:AuthRequest,res:Response)=>{

    try{

        const {collectionId}=req.params;

        // Captured before the write — findByIdAndUpdate returns the new doc.
        const previous = await Collection.findById(collectionId);

        const collection=await Collection.findByIdAndUpdate(

            collectionId,

            req.body,

            {
                new:true
            }

        );


        if(!collection){

            return res.status(404).json({

                message:"Collection not found"

            });

        }

        const moduleItem = await Module.findById(collection.module);
        if (moduleItem) {
            await touchWorkspace(moduleItem.workspace);
            await touchModule(moduleItem._id);

            if (previous && previous.name !== collection.name) {
                await logActivity({
                    workspace: moduleItem.workspace,
                    user: req.user?.id,
                    action: "collection_updated",
                    module: collection.module,
                    collectionName: collection._id,
                    targetName: collection.name,
                    before: previous.name,
                    after: collection.name,
                    message: `renamed collection "${previous.name}" to "${collection.name}"`
                });
            }
        }


        emitChange({
            entity: "collection",
            action: "updated",
            id: String(collection._id),
            workspaceId: moduleItem ? String(moduleItem.workspace) : undefined,
            moduleId: String(collection.module),
            collectionId: String(collection._id),
            data: collection,
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.json({

            message:"Collection updated successfully",
            collection

        });


    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }

};




export const deleteCollection = async(req:AuthRequest,res:Response)=>{

    try{

        const {collectionId}=req.params;


        const collection=await Collection.findByIdAndDelete(collectionId);


        if(!collection){

            return res.status(404).json({

                message:"Collection not found"

            });

        }

        const moduleItem = await Module.findById(collection.module);
        if (moduleItem) {
            await touchWorkspace(moduleItem.workspace);
            await touchModule(moduleItem._id);

            await logActivity({
                workspace: moduleItem.workspace,
                user: req.user?.id,
                action: "collection_deleted",
                module: collection.module,
                targetName: collection.name,
                before: collection.name,
                after: null,
                message: `deleted collection "${collection.name}"`
            });
        }


        emitChange({
            entity: "collection",
            action: "deleted",
            id: String(collection._id),
            workspaceId: moduleItem ? String(moduleItem.workspace) : undefined,
            moduleId: String(collection.module),
            collectionId: String(collection._id),
            actorId: req.user?.id,
            originId: originOf(req)
        });

        res.json({

            message:"Collection deleted successfully"

        });


    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }

};