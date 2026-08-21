import { NextFunction, Request, Response } from "express";
import multer, { FileFilterCallback, MulterError } from "multer";

/**
 * The upload contract, in one place so the client can be told the same numbers
 * it is being held to. Files are buffered in memory and streamed straight to
 * Cloudinary — nothing is ever written to the server's disk.
 */
export const UPLOAD_LIMITS = {
    avatar: {
        maxBytes: 5 * 1024 * 1024,          // 5 MB before compression
        mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]
    },
    attachment: {
        maxBytes: 10 * 1024 * 1024,         // 10 MB
        maxFiles: 10,
        mimeTypes: [
            "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/svg+xml",
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/plain",
            "text/csv",
            "application/zip"
        ]
    }
} as const;

const filterBy = (allowed: readonly string[]) =>
    (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
        if (allowed.includes(file.mimetype)) {
            return cb(null, true);
        }
        cb(new Error(`Unsupported file type: ${file.mimetype}`));
    };

export const uploadAvatarFile = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: UPLOAD_LIMITS.avatar.maxBytes, files: 1 },
    fileFilter: filterBy(UPLOAD_LIMITS.avatar.mimeTypes)
}).single("file");

export const uploadAttachmentFiles = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: UPLOAD_LIMITS.attachment.maxBytes,
        files: UPLOAD_LIMITS.attachment.maxFiles
    },
    fileFilter: filterBy(UPLOAD_LIMITS.attachment.mimeTypes)
}).array("files", UPLOAD_LIMITS.attachment.maxFiles);

/**
 * Multer rejects by throwing, which Express 5 turns into a 500. Translate its
 * failures into the 400 the client can actually show the user.
 */
export const handleUploadError = (
    err: unknown,
    _req: Request,
    res: Response,
    next: NextFunction
) => {
    if (err instanceof MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ message: "File is too large" });
        }
        if (err.code === "LIMIT_FILE_COUNT") {
            return res.status(400).json({ message: "Too many files" });
        }
        return res.status(400).json({ message: "Upload rejected" });
    }

    if (err instanceof Error && err.message.startsWith("Unsupported file type")) {
        return res.status(400).json({ message: err.message });
    }

    return next(err);
};
