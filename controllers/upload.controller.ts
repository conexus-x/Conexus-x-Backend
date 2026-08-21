import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import User from "../models/User";
import FileModel from "../models/File";
import WorkspaceMember from "../models/WorkspaceMember";
import {
    destroyAsset,
    isCloudinaryConfigured,
    uploadAttachment,
    uploadAvatar
} from "../services/cloudinary.service";
import { UPLOAD_LIMITS } from "../middleware/upload.middleware";
import { touchWorkspace } from "../utils/workspaceHelper";

const NOT_CONFIGURED = "Image uploads are not configured on the server";

const fileKind = (mimeType: string): "image" | "document" | "video" | "other" => {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (
        mimeType === "text/plain" ||
        mimeType === "text/csv" ||
        mimeType.startsWith("application/pdf") ||
        mimeType.includes("word") ||
        mimeType.includes("excel") ||
        mimeType.includes("spreadsheet")
    ) {
        return "document";
    }
    return "other";
};

// GET /api/uploads/limits — lets the client enforce the same rules before sending
export const getUploadLimits = async (_req: AuthRequest, res: Response) => {
    res.json({
        configured: isCloudinaryConfigured(),
        limits: UPLOAD_LIMITS
    });
};

// POST /api/uploads/avatar — replaces the signed-in user's profile picture
export const uploadUserAvatar = async (req: AuthRequest, res: Response) => {
    try {
        if (!isCloudinaryConfigured()) {
            return res.status(503).json({ message: NOT_CONFIGURED });
        }

        if (!req.file) {
            return res.status(400).json({ message: "No image provided" });
        }

        const user = await User.findById(req.user?.id);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const result = await uploadAvatar(req.file.buffer, user._id.toString());

        // The public_id is the user id, so a re-upload overwrites in place. Only a
        // leftover from a different id (a mirrored Google picture) needs removing.
        const previous = user.avatarPublicId;

        user.avatar = result.url;
        user.avatarPublicId = result.publicId;
        await user.save();

        if (previous && previous !== result.publicId) {
            await destroyAsset(previous);
        }

        res.json({
            message: "Profile picture updated",
            avatar: result.url,
            bytes: result.bytes,
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
        console.error("Avatar upload error:", error.message);
        res.status(500).json({ message: "Could not upload profile picture" });
    }
};

// DELETE /api/uploads/avatar — clears the picture and frees the Cloudinary asset
export const deleteUserAvatar = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user?.id);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.avatarPublicId) {
            await destroyAsset(user.avatarPublicId);
        }

        user.avatar = "";
        user.avatarPublicId = "";
        await user.save();

        res.json({ message: "Profile picture removed", avatar: "" });

    } catch (error: any) {
        console.error("Avatar delete error:", error.message);
        res.status(500).json({ message: "Could not remove profile picture" });
    }
};

// POST /api/uploads/workspace/:workspaceId — record attachments (file column)
export const uploadWorkspaceFiles = async (req: AuthRequest, res: Response) => {
    try {
        if (!isCloudinaryConfigured()) {
            return res.status(503).json({ message: NOT_CONFIGURED });
        }

        const workspaceId = String(req.params.workspaceId ?? "");
        const files = (req.files as Express.Multer.File[] | undefined) ?? [];

        if (files.length === 0) {
            return res.status(400).json({ message: "No files provided" });
        }

        if (!mongoose.isValidObjectId(workspaceId)) {
            return res.status(400).json({ message: "Invalid workspace id" });
        }

        // Never trust a client-supplied workspace id — confirm membership first.
        const membership = await WorkspaceMember.findOne({
            workspace: workspaceId,
            user: req.user?.id,
            status: "active"
        });

        if (!membership) {
            return res.status(403).json({ message: "Not a member of this workspace" });
        }

        const { recordId } = req.body as { recordId?: string };

        const uploaded = await Promise.all(
            files.map(async (file) => {
                const isImage = file.mimetype.startsWith("image/");

                const result = await uploadAttachment(file.buffer, {
                    workspaceId,
                    isImage
                });

                const doc = await FileModel.create({
                    workspace: workspaceId,
                    uploadedBy: req.user?.id,
                    item: recordId && mongoose.isValidObjectId(recordId) ? recordId : undefined,
                    name: file.originalname,
                    originalName: file.originalname,
                    url: result.url,
                    publicId: result.publicId,
                    mimeType: file.mimetype,
                    size: result.bytes,
                    type: fileKind(file.mimetype)
                });

                return {
                    id: doc._id,
                    name: file.originalname,
                    url: result.url,
                    publicId: result.publicId,
                    mimeType: file.mimetype,
                    bytes: result.bytes,
                    width: result.width,
                    height: result.height,
                    resourceType: result.resourceType
                };
            })
        );

        await touchWorkspace(workspaceId);

        res.status(201).json({ message: "Files uploaded", files: uploaded });

    } catch (error: any) {
        console.error("File upload error:", error.message);
        res.status(500).json({ message: "Could not upload files" });
    }
};

// DELETE /api/uploads/workspace/:workspaceId — body: { publicId }
export const deleteWorkspaceFile = async (req: AuthRequest, res: Response) => {
    try {
        const workspaceId = String(req.params.workspaceId ?? "");
        const { publicId } = req.body as { publicId?: string };

        if (!publicId) {
            return res.status(400).json({ message: "publicId is required" });
        }

        const membership = await WorkspaceMember.findOne({
            workspace: workspaceId,
            user: req.user?.id,
            status: "active"
        });

        if (!membership) {
            return res.status(403).json({ message: "Not a member of this workspace" });
        }

        const doc = await FileModel.findOne({ workspace: workspaceId, publicId });

        await destroyAsset(publicId, doc?.type === "video" ? "video" : "image");

        if (doc) {
            doc.isDeleted = true;
            await doc.save();
        }

        await touchWorkspace(workspaceId);

        res.json({ message: "File removed" });

    } catch (error: any) {
        console.error("File delete error:", error.message);
        res.status(500).json({ message: "Could not remove file" });
    }
};
