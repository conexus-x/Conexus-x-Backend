import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";


export interface AuthRequest extends Request {
    user?: {
        id: string;
    };
}


export const protect = (
    req: AuthRequest,
    res: Response,
    next: NextFunction
) => {

    try {

        const authHeader = req.headers.authorization;


        if(!authHeader){

            return res.status(401).json({
                message:"No token provided"
            });

        }


        const token = authHeader.split(" ")[1];


        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET!
        ) as {
            userId:string;
        };


        req.user = {
            id: decoded.userId
        };


        next();


    } catch(error){

        return res.status(401).json({
            message:"Invalid token"
        });

    }

};