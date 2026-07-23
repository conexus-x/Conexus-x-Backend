import { Request, Response } from "express";
import User from "../models/User";
import { hashPassword, comparePassword } from "../utils/hash";
import { createToken } from "../services/jwt.service";


export const register = async (
    req: Request,
    res: Response
) => {

    try {

        const {
            firstName,
            lastName,
            email,
            password
        } = req.body;


        const existingUser = await User.findOne({
            email
        });


        if (existingUser) {
            return res.status(400).json({
                message: "User already exists"
            });
        }


        const hashedPassword =
            await hashPassword(password);



        const user = await User.create({

            firstName,
            lastName,
            email,
            password: hashedPassword

        });


        res.json({
            message: "User created",
            user
        });


    } catch (error: any) {
        console.error("Registration error:", error);
        
        // Handle Mongoose validation errors
        if (error.name === "ValidationError") {
            return res.status(400).json({
                message: "Validation failed",
                errors: Object.values(error.errors).map((err: any) => err.message)
            });
        }

        res.status(500).json({
            message: "Server error",
            error: error.message
        });
    }

};

export const login = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        // Find user by email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        // Compare password
        const isMatch = await comparePassword(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        // Create JWT token
        const token = createToken(user._id.toString());

        // Return expected response
        res.json({
            message: "Login successful",
            token,
            user: {
                id: user._id,
                firstName: user.firstName,
                email: user.email
            }
        });
    } catch (error: any) {
        console.error("Login error:", error);
        res.status(500).json({
            message: "Server error",
            error: error.message
        });
    }
};