import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import { Request, Response } from "express";
import Board from "../models/Board";


export const createBoard = async(
    req: AuthRequest,
    res:Response
)=>{


    try{


        const {workspaceId} = req.params;

        const {
            name,
            description,
            icon,
            color,
            visibility
        } = req.body;



        const board = await Board.create({

            workspace: new mongoose.Types.ObjectId(workspaceId as string),

            name,

            description,

            icon,

            color,

            visibility,

            createdBy: new mongoose.Types.ObjectId(req.user?.id as string)

        });



        res.status(201).json({

            message:"Board created successfully",

            board

        });



    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }


};





export const getWorkspaceBoards = async(
    req:Request,
    res:Response
)=>{


    try{


        const {workspaceId}=req.params;


        const boards = await Board.find({

            workspace: new mongoose.Types.ObjectId(workspaceId as string),

            isArchived:false

        })

        .populate(
            "createdBy",
            "name email"
        );



        res.json({

            boards

        });



    }
    catch(error:any){

        res.status(500).json({

            message:error.message

        });

    }


};