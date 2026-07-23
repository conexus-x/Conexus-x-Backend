import jwt from "jsonwebtoken";

export const createToken = (userId:string)=>{

    return jwt.sign(
        {
            userId
        },
        process.env.JWT_SECRET!,
        {
            expiresIn:"7d"
        }
    );

};