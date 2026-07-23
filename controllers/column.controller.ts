import { Request, Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import Column from "../models/Column";


export const createColumn = async(req:AuthRequest,res:Response)=>{

    try{

        const {boardId}=req.params;

        const {
            name,
            type,
            options,
            width,
            position,
            isRequired,
            isHidden
        }=req.body;


        const column=await Column.create({

            board: new mongoose.Types.ObjectId(boardId as string),
            name,
            type,
            options,
            width,
            position,
            isRequired,
            isHidden,
            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)

        });


        res.status(201).json({

            message:"Column created successfully",
            column

        });

    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }

};



export const getBoardColumns = async(req:Request,res:Response)=>{

    try{

        const {boardId}=req.params;


        const columns=await Column.find({

            board: new mongoose.Types.ObjectId(boardId as string)

        })
        .sort({

            position:1

        });


        res.status(200).json({

            columns

        });

    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

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