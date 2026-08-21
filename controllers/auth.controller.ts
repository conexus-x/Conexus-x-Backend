import { Request, Response } from "express";
import User from "../models/User";
import { hashPassword, comparePassword } from "../utils/hash";
import { createToken } from "../services/jwt.service";
import { generateApiKey } from "../services/apiKey.service";
import {
    buildGoogleAuthUrl,
    createOAuthState,
    exchangeCodeForTokens,
    fetchGoogleProfile,
    isGoogleConfigured,
    verifyOAuthState,
    OAuthMode
} from "../services/google.service";
import { isCloudinaryConfigured, uploadAvatar } from "../services/cloudinary.service";
import { AuthRequest } from "../middleware/auth.middleware";
import env from "../config/env";


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



        const apiKey = generateApiKey();

        const user = await User.create({
            firstName,
            lastName,
            email,
            password: hashedPassword,
            apiKey
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

        // Google-only accounts have no password to compare
        if (!user.password) {
            return res.status(400).json({
                message: "This account uses Google sign-in. Continue with Google instead."
            });
        }

        // Compare password
        const isMatch = await comparePassword(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        // Ensure user has an API key
        if (!user.apiKey) {
            user.apiKey = generateApiKey();
            await user.save();
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
                lastName: user.lastName,
                email: user.email,
                avatar: user.avatar
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

const GOOGLE_ERRORS = {
    not_configured: "not_configured",
    invalid_state: "invalid_state",
    missing_code: "missing_code",
    no_email: "no_email",
    exchange_failed: "exchange_failed"
} as const;


// GET /api/auth/google — sends the browser to Google's consent screen
export const googleAuth = (req: Request, res: Response) => {

    if (!isGoogleConfigured()) {
        return res.redirect(
            `${env.client_url}/auth/callback#error=${GOOGLE_ERRORS.not_configured}`
        );
    }

    const mode: OAuthMode =
        req.query.mode === "register" ? "register" : "login";

    return res.redirect(buildGoogleAuthUrl(createOAuthState(mode)));

};


// GET /api/auth/google/callback — Google redirects here with ?code&state
/**
 * Google hands back a lh3.googleusercontent.com URL that can rotate or 404 once
 * the user changes their Google picture. Mirror it into Cloudinary so the avatar
 * we render is ours. Best-effort: a failure falls back to the Google URL.
 */
const mirrorGooglePicture = async (
    pictureUrl: string | undefined,
    userId: string
): Promise<{ avatar: string; avatarPublicId: string } | null> => {
    if (!pictureUrl || !isCloudinaryConfigured()) return null;

    try {
        const result = await uploadAvatar(pictureUrl, userId);
        return { avatar: result.url, avatarPublicId: result.publicId };
    } catch (error: any) {
        console.error("Google avatar mirror failed:", error.message);
        return null;
    }
};


export const googleCallback = async (req: Request, res: Response) => {

    const fail = (reason: string) =>
        res.redirect(`${env.client_url}/auth/callback#error=${encodeURIComponent(reason)}`);

    try {

        const { code, state, error } = req.query;

        if (error) {
            return fail(String(error));
        }

        if (!code) {
            return fail(GOOGLE_ERRORS.missing_code);
        }

        try {
            verifyOAuthState(state);
        } catch {
            return fail(GOOGLE_ERRORS.invalid_state);
        }

        const tokens = await exchangeCodeForTokens(String(code));

        const profile = await fetchGoogleProfile(tokens.access_token);

        if (!profile.email) {
            return fail(GOOGLE_ERRORS.no_email);
        }

        const email = profile.email.toLowerCase();


        let user = await User.findOne({
            $or: [{ googleId: profile.sub }, { email }]
        });


        if (!user) {

            const [firstFromName, ...restOfName] = (profile.name || "").split(" ");

            user = await User.create({
                firstName: profile.given_name || firstFromName || "User",
                lastName: profile.family_name || restOfName.join(" ") || undefined,
                email,
                googleId: profile.sub,
                authProvider: "google",
                avatar: profile.picture || "",
                emailVerified: Boolean(profile.email_verified),
                apiKey: generateApiKey(),
                lastLogin: new Date()
            });

            const mirrored = await mirrorGooglePicture(profile.picture, user._id.toString());

            if (mirrored) {
                user.avatar = mirrored.avatar;
                user.avatarPublicId = mirrored.avatarPublicId;
                await user.save();
            }

        } else {

            // Existing local account signing in with Google for the first time
            if (!user.googleId) {
                user.googleId = profile.sub;
            }

            // Only fill a blank avatar — never overwrite a picture the user uploaded.
            if (!user.avatar && profile.picture) {
                const mirrored = await mirrorGooglePicture(profile.picture, user._id.toString());

                if (mirrored) {
                    user.avatar = mirrored.avatar;
                    user.avatarPublicId = mirrored.avatarPublicId;
                } else {
                    user.avatar = profile.picture;
                }
            }

            if (!user.apiKey) {
                user.apiKey = generateApiKey();
            }

            user.emailVerified = user.emailVerified || Boolean(profile.email_verified);
            user.lastLogin = new Date();

            await user.save();

        }


        const token = createToken(user._id.toString());

        // Fragment, not query string: the token never reaches a server log or referrer header
        return res.redirect(
            `${env.client_url}/auth/callback#token=${encodeURIComponent(token)}`
        );


    } catch (error: any) {

        console.error("Google OAuth error:", error.message);

        return fail(GOOGLE_ERRORS.exchange_failed);

    }

};


// GET /api/auth/me — resolves the signed-in user from the Bearer token
export const me = async (req: AuthRequest, res: Response) => {

    try {

        const user = await User.findById(req.user?.id).select(
            "-password -apiKey"
        );

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json({
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                avatar: user.avatar,
                authProvider: user.authProvider
            }
        });

    } catch (error: any) {

        console.error("Fetch profile error:", error.message);

        res.status(500).json({ message: "Server error" });

    }

};
