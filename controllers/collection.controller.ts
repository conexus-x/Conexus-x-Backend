import { Request, Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import Collection from "../models/Collection";
import Module from "../models/Module";
import { touchWorkspace } from "../utils/workspaceHelper";


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
        }


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


        const collections=await Collection.find({

            module: new mongoose.Types.ObjectId(moduleId as string)

        })
        .sort({
            position:1
        })
        .populate(
            "createdBy",
            "firstName lastName email"
        );


        res.json({

            collections

        });


    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }

};




export const updateCollection = async(req:Request,res:Response)=>{

    try{

        const {collectionId}=req.params;


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
        }


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




export const deleteCollection = async(req:Request,res:Response)=>{

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
        }


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