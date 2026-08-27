import mongoose, { Document, Schema } from "mongoose";

/**
 * One message in a conversation.
 *
 * Text and attachments are NOT exclusive: a person sends three screenshots with
 * a sentence explaining them, and splitting that into four rows would break the
 * thread it was written as.
 *
 * Deletion is a TOMBSTONE, the same rule amendments follow: a reply quoting a
 * message that no longer exists reads as a non-sequitur, so the row survives
 * with its text cleared and renders as "This message was deleted."
 */

export interface MessageAttachment {
    url: string;
    /** Cloudinary public_id — without it the asset can never be deleted. */
    publicId: string;
    kind: "image" | "video" | "document" | "other";
    name: string;
    bytes: number;
    width?: number;
    height?: number;
}

export interface IMessage extends Document {
    _id: mongoose.Types.ObjectId;
    conversation: mongoose.Types.ObjectId;
    /** Carried so a workspace delete can sweep messages without a join. */
    workspace: mongoose.Types.ObjectId;
    sender: mongoose.Types.ObjectId;
    text: string;
    attachments: MessageAttachment[];
    /** The message this one answers, for a quoted reply. One level, like everywhere else. */
    replyTo: mongoose.Types.ObjectId | null;
    editedAt: Date | null;
    isDeleted: boolean;

    /**
     * A CALL EVENT rather than a typed message — "Ali started a video call",
     * "Call ended · 4m 12s". Calls happen inside a conversation, so their
     * history belongs in the transcript people scroll, not in a second log.
     */
    system: {
        type: string;
        callKind: string;
        durationMs: number;
    } | null;

    createdAt: Date;
    updatedAt: Date;
}

const attachmentSchema = new Schema<MessageAttachment>(
    {
        url: { type: String, required: true },
        publicId: { type: String, default: "" },
        kind: {
            type: String,
            enum: ["image", "video", "document", "other"],
            default: "other"
        },
        name: { type: String, default: "" },
        bytes: { type: Number, default: 0 },
        width: Number,
        height: Number
    },
    { _id: false }
);

const messageSchema = new Schema<IMessage>(
    {
        conversation: {
            type: Schema.Types.ObjectId,
            ref: "Conversation",
            required: true,
            index: true
        },
        workspace: {
            type: Schema.Types.ObjectId,
            ref: "Workspace",
            required: true
        },
        sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
        text: { type: String, default: "", maxlength: 4000 },
        attachments: { type: [attachmentSchema], default: [] },
        replyTo: { type: Schema.Types.ObjectId, ref: "Message", default: null },
        editedAt: { type: Date, default: null },
        isDeleted: { type: Boolean, default: false },
        system: {
            type: {
                type: String,
                default: ""
            },
            callKind: { type: String, default: "" },
            durationMs: { type: Number, default: 0 }
        }
    },
    { timestamps: true }
);

/** Keyset paging reads a thread newest-first and walks backwards by createdAt. */
messageSchema.index({ conversation: 1, createdAt: -1 });

export default mongoose.models.Message ||
    mongoose.model<IMessage>("Message", messageSchema);
