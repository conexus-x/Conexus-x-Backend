import { Request, Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import Group from "../models/Group";


export const createGroup = async(req:AuthRequest,res:Response)=>{

    try{

        const {boardId}=req.params;

        const {name,color,position}=req.body;


        const group=await Group.create({

            board: new mongoose.Types.ObjectId(boardId as string),
            name,
            color,
            position:position || 0,
            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)

        });


        res.status(201).json({

            message:"Group created successfully",
            group

        });


    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }

};




export const getBoardGroups = async(req:Request,res:Response)=>{

    try{

        const {boardId}=req.params;


        const groups=await Group.find({

            board: new mongoose.Types.ObjectId(boardId as string)

        })
        .sort({
            position:1
        })
        .populate(
            "createdBy",
            "firstName lastName email"
        );


        res.json({

            groups

        });


    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }

};




export const updateGroup = async(req:Request,res:Response)=>{

    try{

        const {groupId}=req.params;


        const group=await Group.findByIdAndUpdate(

            groupId,

            req.body,

            {
                new:true
            }

        );


        if(!group){

            return res.status(404).json({

                message:"Group not found"

            });

        }


        res.json({

            message:"Group updated successfully",
            group

        });


    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }

};




export const deleteGroup = async(req:Request,res:Response)=>{

    try{

        const {groupId}=req.params;


        const group=await Group.findByIdAndDelete(groupId);


        if(!group){

            return res.status(404).json({

                message:"Group not found"

            });

        }


        res.json({

            message:"Group deleted successfully"

        });


    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }

};