import mongoose, { Document, Schema } from "mongoose";

/**
 * A chat thread — Conexus Meet.
 *
 * WORKSPACE-SCOPED, deliberately. Membership, roles and presence are all per
 * workspace in this product, so a conversation that spanned them would need a
 * second, parallel idea of "who can talk to whom" — and the first person added
 * from outside the workspace would have access to a thread about records they
 * cannot open.
 *
 * TWO KINDS, one model. A `direct` thread is the degenerate case of a group: it
 * has exactly two members, no name, and is looked up by its member pair rather
 * than created twice. Splitting them into two collections would double every
 * list, unread count and message query for no gain.
 */

export const CONVERSATION_KINDS = ["direct", "group"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export interface ConversationMember {
    user: mongoose.Types.ObjectId;
    /** Group admins can rename, add and remove. A direct thread has no admins. */
    isAdmin: boolean;
    joinedAt: Date;
    /**
     * The unread count is DERIVED from this, never stored as a number: a stored
     * counter has to be incremented for every member on every send and drifts
     * the first time one of those writes fails.
     */
    lastReadAt: Date | null;
}

export interface IConversation extends Document {
    _id: mongoose.Types.ObjectId;
    workspace: mongoose.Types.ObjectId;
    kind: ConversationKind;
    /** Groups only. A direct thread is named after the other person, on read. */
    name: string;
    /** A key from the client's icon catalog, never a URL — same rule as Workspace.icon. */
    icon: string;
    members: ConversationMember[];
    createdBy: mongoose.Types.ObjectId;

    /**
     * Denormalised preview of the newest message, so the conversation LIST is
     * one query. Without it, drawing twenty rows with "who said what last" is
     * twenty extra lookups on a screen that is nothing but that list.
     */
    lastMessage: {
        text: string;
        sender: mongoose.Types.ObjectId | null;
        at: Date | null;
        /** Set when the last message was a file, so the row can say so. */
        kind: string;
    };

    createdAt: Date;
    updatedAt: Date;
}

const memberSchema = new Schema<ConversationMember>(
    {
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        isAdmin: { type: Boolean, default: false },
        joinedAt: { type: Date, default: Date.now },
        lastReadAt: { type: Date, default: null }
    },
    { _id: false }
);

const conversationSchema = new Schema<IConversation>(
    {
        workspace: {
            type: Schema.Types.ObjectId,
            ref: "Workspace",
            required: true,
            index: true
        },
        kind: {
            type: String,
            enum: CONVERSATION_KINDS,
            default: "group"
        },
        name: { type: String, trim: true, default: "", maxlength: 80 },
        icon: { type: String, default: "" },
        members: { type: [memberSchema], default: [] },
        createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

        lastMessage: {
            text: { type: String, default: "" },
            sender: { type: Schema.Types.ObjectId, ref: "User", default: null },
            at: { type: Date, default: null },
            kind: { type: String, default: "" }
        }
    },
    { timestamps: true }
);

/**
 * The one query the app makes constantly: "my threads in this workspace, newest
 * first". `members.user` is the selector and lastMessage.at is the sort, so they
 * belong in one compound index rather than two that Mongo has to intersect.
 */
conversationSchema.index({ workspace: 1, "members.user": 1, "lastMessage.at": -1 });

export default mongoose.models.Conversation ||
    mongoose.model<IConversation>("Conversation", conversationSchema);
