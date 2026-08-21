import { v2 as cloudinary, UploadApiOptions, UploadApiResponse } from "cloudinary";
import env from "../config/env";

/**
 * Every upload passes through here so the size, format and compression rules
 * live in exactly one place. The client compresses first to save bandwidth,
 * but these transformations are what actually guarantee the stored asset —
 * a client can always be bypassed.
 */

export const isCloudinaryConfigured = (): boolean =>
    Boolean(
        env.cloudinary_cloud_name &&
        env.cloudinary_api_key &&
        env.cloudinary_api_secret
    );

let configured = false;

const configure = () => {
    if (configured) return;

    if (!isCloudinaryConfigured()) {
        throw new Error("Cloudinary is not configured");
    }

    cloudinary.config({
        cloud_name: env.cloudinary_cloud_name,
        api_key: env.cloudinary_api_key,
        api_secret: env.cloudinary_api_secret,
        secure: true
    });

    configured = true;
};

const folder = (name: string) => `${env.cloudinary_folder}/${name}`;

/** Square, face-aware crop — avatars are only ever rendered small and round. */
export const AVATAR_TRANSFORM: UploadApiOptions["transformation"] = [
    { width: 512, height: 512, crop: "fill", gravity: "face" },
    { quality: "auto:good", fetch_format: "auto" }
];

/** Attachments keep their aspect ratio; only oversized originals are shrunk. */
export const ATTACHMENT_TRANSFORM: UploadApiOptions["transformation"] = [
    { width: 1920, height: 1920, crop: "limit" },
    { quality: "auto:good", fetch_format: "auto" }
];

export interface UploadResult {
    url: string;
    publicId: string;
    bytes: number;
    format: string;
    width?: number;
    height?: number;
    resourceType: string;
}

const toResult = (res: UploadApiResponse): UploadResult => ({
    url: res.secure_url,
    publicId: res.public_id,
    bytes: res.bytes,
    format: res.format,
    width: res.width,
    height: res.height,
    resourceType: res.resource_type
});

const upload = (
    source: string | Buffer,
    options: UploadApiOptions
): Promise<UploadResult> => {
    configure();

    // Buffers go through upload_stream; remote URLs and data URIs use upload().
    if (Buffer.isBuffer(source)) {
        return new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
                if (error || !result) {
                    return reject(error ?? new Error("Cloudinary upload returned no result"));
                }
                resolve(toResult(result));
            });
            stream.end(source);
        });
    }

    return cloudinary.uploader
        .upload(source, options)
        .then(toResult);
};

/** Profile picture — always an image, always squared off. */
export const uploadAvatar = (source: string | Buffer, userId: string) =>
    upload(source, {
        folder: folder("avatars"),
        public_id: userId,
        overwrite: true,
        invalidate: true,
        resource_type: "image",
        transformation: AVATAR_TRANSFORM
    });

/** Record attachment — images are re-encoded, other files are stored as-is. */
export const uploadAttachment = (
    buffer: Buffer,
    { workspaceId, isImage }: { workspaceId: string; isImage: boolean }
) =>
    upload(buffer, {
        folder: folder(`workspaces/${workspaceId}`),
        resource_type: isImage ? "image" : "auto",
        use_filename: true,
        unique_filename: true,
        ...(isImage ? { transformation: ATTACHMENT_TRANSFORM } : {})
    });

/** Best-effort delete — a failure here must never fail the caller's request. */
export const destroyAsset = async (
    publicId: string,
    resourceType: "image" | "video" | "raw" = "image"
): Promise<boolean> => {
    if (!publicId || !isCloudinaryConfigured()) return false;

    try {
        configure();
        const res = await cloudinary.uploader.destroy(publicId, {
            resource_type: resourceType,
            invalidate: true
        });
        return res.result === "ok" || res.result === "not found";
    } catch (error) {
        console.error("Cloudinary destroy failed:", (error as Error).message);
        return false;
    }
};
