import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import User from "../models/User";
import { generateApiKey } from "../services/apiKey.service";


// GET /api/api-key — return the current user's API key (generate if not present)
export const getApiKey = async (
    req: AuthRequest,
    res: Response
) => {

    try {

        let user = await User.findById(req.user?.id);

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        if (!user.apiKey) {
            user.apiKey = generateApiKey();
            await user.save();
        }

        res.json({
            apiKey: user.apiKey
        });

    } catch (error: any) {
        console.error("Get API key error:", error);
        res.status(500).json({
            message: "Server error",
            error: error.message
        });
    }

};


// POST /api/api-key/generate — regenerate/change the API key
export const generateKey = async (
    req: AuthRequest,
    res: Response
) => {

    try {

        const apiKey = generateApiKey();

        const user = await User.findByIdAndUpdate(
            req.user?.id,
            { apiKey },
            { returnDocument: "after" }
        ).select("apiKey");

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        res.json({
            message: "API key updated",
            apiKey: user.apiKey
        });

    } catch (error: any) {
        console.error("Generate API key error:", error);
        res.status(500).json({
            message: "Server error",
            error: error.message
        });
    }

};

