import { Request, Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import Column from "../models/Column";
import Module from "../models/Module";
import { touchWorkspace } from "../utils/workspaceHelper";


export const createColumn = async(req:AuthRequest,res:Response)=>{

    try{
        const {moduleId}=req.params;
        const { name,type,options,statusOptions,width,position,isRequired,isHidden }=req.body;
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
            type,options,statusOptions: initialStatusOptions,width,position,isRequired,isHidden,
            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)
        });

        const moduleItem = await Module.findById(moduleId);
        if (moduleItem) {
            await touchWorkspace(moduleItem.workspace);
        }
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
        const columns=await Column.find({
            module: new mongoose.Types.ObjectId(moduleId as string)
        })
        .sort({ position:1});
        res.status(200).json({columns});

    }
    catch(error:any){
        res.status(500).json({message:error.message});
    }
};


export const updateColumn = async(req:Request,res:Response)=>{

    try{
        const {columnId}=req.params;
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
        }


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



export const deleteColumn = async(req:Request,res:Response)=>{

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
        }


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