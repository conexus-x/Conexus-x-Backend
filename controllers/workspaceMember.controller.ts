import { Request, Response } from "express";
import mongoose from "mongoose";
import WorkspaceMember from "../models/WorkspaceMember";
import User from "../models/User";
import { touchWorkspace } from "../utils/workspaceHelper";

interface AuthRequest extends Request {
    user?: {
        id: string;
    };
}


// Get workspace members
export const getWorkspaceMembers = async (
    req: AuthRequest,
    res: Response
) => {

    try {

        const { workspaceId } = req.params;


        const members = await WorkspaceMember.find({
            workspace: workspaceId
        })
            .populate(
                "user",
                "firstName lastName email"
            );


        return res.json({
            members
        });


    } catch (error: any) {

        return res.status(500).json({
            message: error.message
        });

    }

};




// Add member to workspace
export const addWorkspaceMember = async (
    req: AuthRequest,
    res: Response
) => {

    try {


        const {
            workspaceId
        } = req.params;


        const { email, userId, role } = req.body;

        if (!mongoose.Types.ObjectId.isValid(workspaceId as string)) {
            return res.status(400).json({
                message: "Invalid workspace ID format"
            });
        }

        let user;
        if (email) {
            user = await User.findOne({ email });
        } else if (userId) {
            if (mongoose.Types.ObjectId.isValid(userId as string)) {
                user = await User.findById(userId as string);
            } else {
                // Fallback in case user typed an email in the User ID field
                user = await User.findOne({ email: userId as string });
            }
        } else {
            return res.status(400).json({
                message: "User email or ID is required"
            });
        }


        if (!user) {

            return res.status(404).json({
                message: "User not found"
            });

        }

        const exists = await WorkspaceMember.findOne({

            workspace: workspaceId,

            user: user._id

        });



        if (exists) {

            return res.status(400).json({
                message: "User already member"
            });

        }



        const member = await WorkspaceMember.create({

            workspace: new mongoose.Types.ObjectId(workspaceId as string),

            user: user._id,

            role: role || "member",

            invitedBy: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined

        });

        await touchWorkspace(workspaceId as string);

        return res.status(201).json({

            message: "Member added successfully",

            member

        });


    } catch (error: any) {

        return res.status(500).json({
            message: error.message
        });

    }

};





// Remove member
export const removeWorkspaceMember = async (
    req: AuthRequest,
    res: Response
) => {

    try {


        const {
            workspaceId,
            userId
        } = req.params;



        await WorkspaceMember.findOneAndDelete({

            workspace: workspaceId,

            user: userId

        });

        await touchWorkspace(workspaceId as string);

        return res.json({

            message: "Member removed successfully"

        });



    } catch (error: any) {

        return res.status(500).json({
            message: error.message
        });

    }

};