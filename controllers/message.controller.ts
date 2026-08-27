// controllers/message.controller.ts

import { Response } from "express";
import mongoose from "mongoose";
import { AuthRequest } from "./wrokspace.controller";
import Conversation from "../models/Conversation";
import Message from "../models/Message";
import { emitChange, originOf } from "../services/realtime.service";
import {
    isCloudinaryConfigured,
    uploadAttachment
} from "../services/cloudinary.service";

/**
 * The messages inside a Conexus Meet thread.
 *
 * KEYSET PAGING, not offset. A thread grows from the top while you read it, so
 * page 2 of an offset query re-serves rows that just shifted down — the same
 * reason GET /api/activity was left on keyset when everything else moved to
 * offset. `before` is the oldest createdAt you already hold.
 */

const SENDER_FIELDS = "firstName lastName email avatar";

const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;

/** Access is membership of the THREAD, and every route in this file asks. */
const requireMember = async (conversationId: string, userId: string) => {
    if (!mongoose.isValidObjectId(conversationId)) return null;

    return Conversation.findOne({
        _id: conversationId,
        "members.user": userId
    });
};

/** A tombstone keeps its row and loses its content — see models/Message.ts. */
const publicMessage = (doc: any) => {
    const m = doc?._doc ?? doc;

    if (m.isDeleted) {
        return {
            ...m,
            text: "",
            attachments: [],
            isDeleted: true
        };
    }

    return m;
};

// GET /api/messages/:conversationId?limit=&before=
export const listMessages = async (req: AuthRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const me = String(req.user?.id);

        const conversation = await requireMember(String(conversationId), me);
        if (!conversation) {
            return res.status(403).json({ message: "You are not in this conversation" });
        }

        const limit = Math.min(
            Math.max(Number(req.query.limit) || DEFAULT_PAGE, 1),
            MAX_PAGE
        );

        const filter: Record<string, unknown> = { conversation: conversationId };

        if (req.query.before) {
            const before = new Date(String(req.query.before));
            if (!Number.isNaN(before.getTime())) {
                filter.createdAt = { $lt: before };
            }
        }

        // Read newest-first (that is what the index serves), then hand the
        // client oldest-first, which is the order a transcript is read in.
        const rows = await Message.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .populate("sender", SENDER_FIELDS)
            .populate({ path: "replyTo", select: "text sender isDeleted", populate: { path: "sender", select: SENDER_FIELDS } });

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;

        res.json({
            messages: page.map(publicMessage).reverse(),
            hasMore,
            /** Feed this back as `before` to walk further up the thread. */
            nextCursor: hasMore ? page[page.length - 1].createdAt : null
        });
    } catch (error: any) {
        console.error("List messages error:", error.message);
        res.status(500).json({ message: "Could not load messages" });
    }
};

/**
 * POST /api/messages/:conversationId  { text, replyTo }
 *
 * Attachments arrive through their own multipart route below — a JSON send is
 * the hot path and must not pay for multipart parsing it never uses.
 */
export const sendMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const me = String(req.user?.id);

        const conversation = await requireMember(String(conversationId), me);
        if (!conversation) {
            return res.status(403).json({ message: "You are not in this conversation" });
        }

        const text = String(req.body?.text ?? "").trim();

        if (!text) {
            return res.status(400).json({ message: "A message cannot be empty" });
        }

        const replyTo = req.body?.replyTo;

        if (replyTo) {
            // A quoted reply has to point at a message in THIS thread, or the
            // quote renders content from a conversation the reader cannot open.
            const parent = await Message.findById(replyTo).select("conversation");

            if (!parent || String(parent.conversation) !== String(conversationId)) {
                return res.status(400).json({
                    message: "That message is not in this conversation"
                });
            }
        }

        const message = await Message.create({
            conversation: conversationId,
            workspace: conversation.workspace,
            sender: me,
            text,
            replyTo: replyTo || null
        });

        await message.populate("sender", SENDER_FIELDS);
        if (replyTo) {
            await message.populate({
                path: "replyTo",
                select: "text sender isDeleted",
                populate: { path: "sender", select: SENDER_FIELDS }
            });
        }

        await stampLastMessage(conversation, message, text, "");

        emitChange({
            entity: "message",
            action: "created",
            id: String(message._id),
            workspaceId: String(conversation.workspace),
            conversationId: String(conversationId),
            data: publicMessage(message),
            actorId: me,
            // NO originId: the sender's own client renders from this event too,
            // which is what replaces its optimistic bubble with the stored row
            // and gives it the real id, timestamp and populated sender.
        });

        res.status(201).json({ message: "Sent", data: publicMessage(message) });
    } catch (error: any) {
        console.error("Send message error:", error.message);
        res.status(500).json({ message: "Could not send that message" });
    }
};

/**
 * Keeps the conversation row's preview current.
 *
 * Denormalised on purpose (see models/Conversation.ts) — and written with
 * updateOne rather than save(), because the caller may hold a stale copy of a
 * members array that another request has just changed.
 */
const stampLastMessage = async (
    conversation: any,
    message: any,
    text: string,
    kind: string
) => {
    await Conversation.updateOne(
        { _id: conversation._id },
        {
            $set: {
                "lastMessage.text": text,
                "lastMessage.sender": message.sender?._id ?? message.sender,
                "lastMessage.at": message.createdAt,
                "lastMessage.kind": kind
            }
        }
    );

    /**
     * The LIST has to reorder for everyone in the thread, including people who
     * do not have it open — so this goes to their personal rooms, not to
     * conv:<id>, which only holds whoever is currently reading.
     */
    emitChange({
        entity: "conversation",
        action: "updated",
        id: String(conversation._id),
        workspaceId: String(conversation.workspace),
        conversationId: String(conversation._id),
        audience: (conversation.members ?? []).map((m: any) =>
            String(m.user?._id ?? m.user)
        ),
        data: {
            _id: String(conversation._id),
            lastMessage: {
                text,
                sender: String(message.sender?._id ?? message.sender),
                at: message.createdAt,
                kind
            }
        },
        actorId: String(message.sender?._id ?? message.sender)
    });
};

/**
 * POST /api/messages/:conversationId/attachments  (multipart)
 *
 * Reuses the workspace attachment pipeline — same multer limits, same
 * Cloudinary transforms, same folder scheme. A second upload path would be a
 * second set of size rules to keep in step with the client's.
 */
export const sendAttachments = async (req: AuthRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const me = String(req.user?.id);

        const conversation = await requireMember(String(conversationId), me);
        if (!conversation) {
            return res.status(403).json({ message: "You are not in this conversation" });
        }

        if (!isCloudinaryConfigured()) {
            return res.status(503).json({
                message: "File sharing is not configured on the server"
            });
        }

        const files = (req.files as Express.Multer.File[]) ?? [];

        if (!files.length) {
            return res.status(400).json({ message: "No files provided" });
        }

        const uploaded = await Promise.all(
            files.map(async (file) => {
                const isImage = file.mimetype.startsWith("image/");

                const result = await uploadAttachment(file.buffer, {
                    workspaceId: String(conversation.workspace),
                    isImage
                });

                return {
                    url: result.url,
                    publicId: result.publicId,
                    kind: isImage
                        ? ("image" as const)
                        : file.mimetype.startsWith("video/")
                            ? ("video" as const)
                            : file.mimetype === "application/pdf" ||
                                file.mimetype.startsWith("text/") ||
                                file.mimetype.includes("word") ||
                                file.mimetype.includes("sheet")
                                ? ("document" as const)
                                : ("other" as const),
                    name: file.originalname,
                    bytes: result.bytes,
                    width: result.width,
                    height: result.height
                };
            })
        );

        const text = String(req.body?.text ?? "").trim();

        const message = await Message.create({
            conversation: conversationId,
            workspace: conversation.workspace,
            sender: me,
            text,
            attachments: uploaded
        });

        await message.populate("sender", SENDER_FIELDS);

        // The list preview says what it was when there are no words with it.
        const preview =
            text ||
            (uploaded.length === 1
                ? uploaded[0].name || "Shared a file"
                : `Shared ${uploaded.length} files`);

        await stampLastMessage(conversation, message, preview, uploaded[0].kind);

        emitChange({
            entity: "message",
            action: "created",
            id: String(message._id),
            workspaceId: String(conversation.workspace),
            conversationId: String(conversationId),
            data: publicMessage(message),
            actorId: me
        });

        res.status(201).json({ message: "Sent", data: publicMessage(message) });
    } catch (error: any) {
        console.error("Send attachment error:", error.message);
        res.status(500).json({ message: "Could not share those files" });
    }
};

// PUT /api/messages/:messageId  { text }
export const editMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { messageId } = req.params;
        const me = String(req.user?.id);

        const message = await Message.findById(messageId);

        if (!message || message.isDeleted) {
            return res.status(404).json({ message: "Message not found" });
        }

        // Authorship, not access — the same rule amendments follow. A team
        // admin may remove someone's message, never rewrite it.
        if (String(message.sender) !== me) {
            return res.status(403).json({ message: "You can only edit your own messages" });
        }

        const text = String(req.body?.text ?? "").trim();

        if (!text) {
            return res.status(400).json({ message: "A message cannot be empty" });
        }

        if (message.text !== text) {
            message.text = text;
            message.editedAt = new Date();
            await message.save();
        }

        await message.populate("sender", SENDER_FIELDS);

        emitChange({
            entity: "message",
            action: "updated",
            id: String(message._id),
            workspaceId: String(message.workspace),
            conversationId: String(message.conversation),
            data: publicMessage(message),
            actorId: me,
            originId: originOf(req)
        });

        res.json({ message: "Saved", data: publicMessage(message) });
    } catch (error: any) {
        console.error("Edit message error:", error.message);
        res.status(500).json({ message: "Could not save that edit" });
    }
};

// DELETE /api/messages/:messageId
export const deleteMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { messageId } = req.params;
        const me = String(req.user?.id);

        const message = await Message.findById(messageId);

        if (!message || message.isDeleted) {
            return res.status(404).json({ message: "Message not found" });
        }

        const conversation = await Conversation.findById(message.conversation);

        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found" });
        }

        const mine = String(message.sender) === me;

        const admin = (conversation.members ?? []).some(
            (m: any) => String(m.user) === me && m.isAdmin
        );

        if (!mine && !admin) {
            return res.status(403).json({
                message: "You can only delete your own messages"
            });
        }

        /**
         * TOMBSTONE, not a removal. A reply quoting a message that vanished
         * reads as a non-sequitur, so the row survives with its content cleared
         * — the same decision amendments landed on, for the same reason.
         */
        message.isDeleted = true;
        message.text = "";
        message.attachments = [] as any;
        await message.save();

        emitChange({
            entity: "message",
            action: "deleted",
            id: String(message._id),
            workspaceId: String(message.workspace),
            conversationId: String(message.conversation),
            data: publicMessage(message),
            actorId: me,
            originId: originOf(req)
        });

        res.json({ message: "Message deleted" });
    } catch (error: any) {
        console.error("Delete message error:", error.message);
        res.status(500).json({ message: "Could not delete that message" });
    }
};

/**
 * POST /api/messages/:conversationId/call  { event, callKind, durationMs }
 *
 * A call leaves a row in the transcript. Calls happen INSIDE a conversation, so
 * "Ali started a video call" belongs in the thread people scroll, not in a
 * second history nobody would think to open.
 */
export const logCallEvent = async (req: AuthRequest, res: Response) => {
    try {
        const { conversationId } = req.params;
        const me = String(req.user?.id);

        const conversation = await requireMember(String(conversationId), me);
        if (!conversation) {
            return res.status(403).json({ message: "You are not in this conversation" });
        }

        const event = String(req.body?.event ?? "");
        const callKind = req.body?.callKind === "video" ? "video" : "audio";

        if (!["started", "ended", "missed"].includes(event)) {
            return res.status(400).json({ message: "Unknown call event" });
        }

        const durationMs = Math.max(0, Number(req.body?.durationMs) || 0);

        const message = await Message.create({
            conversation: conversationId,
            workspace: conversation.workspace,
            sender: me,
            text: "",
            system: { type: `call_${event}`, callKind, durationMs }
        });

        await message.populate("sender", SENDER_FIELDS);

        const preview =
            event === "started"
                ? `Started a ${callKind} call`
                : event === "missed"
                    ? "Missed call"
                    : `${callKind === "video" ? "Video" : "Audio"} call ended`;

        await stampLastMessage(conversation, message, preview, "call");

        emitChange({
            entity: "message",
            action: "created",
            id: String(message._id),
            workspaceId: String(conversation.workspace),
            conversationId: String(conversationId),
            data: publicMessage(message),
            actorId: me
        });

        res.status(201).json({ data: publicMessage(message) });
    } catch (error: any) {
        console.error("Log call event error:", error.message);
        res.status(500).json({ message: "Could not record that call" });
    }
};
