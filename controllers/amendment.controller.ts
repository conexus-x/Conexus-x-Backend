import { Response } from "express";
import mongoose from "mongoose";
// STORAGE KEEPS ITS OLD NAME. The product calls these amendments, but the
// model — and therefore the Mongo collection — shipped with the repo as
// `Comment`. Renaming it would be a data migration for zero user benefit, so
// the rule is: everything a person reads says "amendment", the collection on
// disk stays `comments`. Same reasoning applies to the comment_added /
// comment_deleted activity actions, which already have rows written against them.
import Comment from "../models/Comment";
import Record from "../models/Record";
import { ModuleAccessRequest } from "../middleware/access.middleware";
import { isWorkspaceManager } from "../services/access.service";
import { touchWorkspace } from "../utils/workspaceHelper";
import { logActivity } from "../services/activity.service";
import { runAutomations } from "../services/automation.service";

/**
 * Amendments: the conversation hanging off a single record.
 *
 * Deliberately NOT the activity log. The activity log is written by the server
 * about what changed; an amendment is written by a person about what it means,
 * and the two are read for different reasons — which is why this is its own
 * model and its own panel rather than another Activity action.
 *
 * Access is the module's: the routes go through requireModuleAccess, so anyone
 * who can open the module can read and post. Editing and deleting are narrower
 * and checked here, because they are about authorship, not access.
 */

/** What each amendment is rendered with — never the raw user document. */
const AUTHOR_FIELDS = "firstName lastName email avatar";

export const getRecordAmendments = async (req: ModuleAccessRequest, res: Response) => {
    try {
        const { recordId } = req.params;

        if (!mongoose.isValidObjectId(String(recordId))) {
            return res.status(400).json({ message: "Invalid record id" });
        }

        const amendments = await Comment.find({
            record: new mongoose.Types.ObjectId(recordId as string)
        })
            .populate("user", AUTHOR_FIELDS)
            .sort({ createdAt: 1 })
            .lean();

        /**
         * A deleted amendment is kept as a tombstone ONLY while a live reply
         * still hangs off it — dropping it would strand the thread under a
         * parent that no longer exists. Everything else deleted is filtered out
         * here, so the client never has to know the rule.
         */
        const answeredParents = new Set(
            amendments
                .filter((a) => !a.isDeleted && a.parentComment)
                .map((a) => String(a.parentComment))
        );

        const visible = amendments.filter(
            (a) => !a.isDeleted || answeredParents.has(String(a._id))
        );

        res.status(200).json({
            // `parentComment` stays the wire field: it is the schema's name, and
            // renaming it here would buy a mapping layer and nothing else.
            amendments: visible.map((a) =>
                a.isDeleted ? { ...a, message: "", user: null } : a
            )
        });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const createAmendment = async (req: ModuleAccessRequest, res: Response) => {
    try {
        const { recordId } = req.params;
        const { message, parentComment } = req.body ?? {};

        const text = typeof message === "string" ? message.trim() : "";

        if (!text) {
            return res.status(400).json({ message: "An amendment cannot be empty" });
        }

        const record = await Record.findById(recordId);

        if (!record) {
            return res.status(404).json({ message: "Record not found" });
        }

        if (parentComment) {
            const parent = await Comment.findById(parentComment);

            // A reply has to belong to the record it is drawn under, and one
            // level is the contract — the same rule sub-records follow.
            if (!parent || String(parent.record) !== String(record._id)) {
                return res
                    .status(400)
                    .json({ message: "Parent amendment not found on this record" });
            }

            if (parent.parentComment) {
                return res
                    .status(400)
                    .json({ message: "A reply cannot have replies of its own" });
            }
        }

        const amendment = await Comment.create({
            workspace: record.workspace,
            module: record.module,
            record: record._id,
            user: new mongoose.Types.ObjectId(req.user?.id as string),
            message: text,
            parentComment: parentComment || null
        });

        await amendment.populate("user", AUTHOR_FIELDS);

        await touchWorkspace(record.workspace);

        await logActivity({
            workspace: record.workspace,
            user: req.user?.id,
            action: "comment_added",
            module: record.module,
            collectionName: record.collectionName,
            record: record._id,
            targetName: record.name,
            after: text,
            message: parentComment
                ? `replied to an amendment on "${record.name}"`
                : `posted an amendment on "${record.name}"`
        });

        /**
         * Root amendments only. A reply is part of a conversation that already
         * fired the trigger, and re-firing on every reply would turn one
         * recipe ("flag the record when someone comments") into a flag per
         * message in a thread.
         *
         * The engine's subject guard drops this for a sub-record, which is
         * deliberate — see subjectOf() in services/automation/triggers.ts.
         */
        if (!parentComment) {
            void runAutomations({
                type: "amendment_posted",
                workspace: record.workspace,
                module: record.module,
                record: record._id,
                user: req.user?.id as string,
                after: text,
                text
            });
        }

        res.status(201).json({ message: "Amendment posted successfully", amendment });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const updateAmendment = async (req: ModuleAccessRequest, res: Response) => {
    try {
        const { amendmentId } = req.params;
        const { message } = req.body ?? {};

        const text = typeof message === "string" ? message.trim() : "";

        if (!text) {
            return res.status(400).json({ message: "An amendment cannot be empty" });
        }

        const amendment = await Comment.findById(amendmentId);

        if (!amendment || amendment.isDeleted) {
            return res.status(404).json({ message: "Amendment not found" });
        }

        // Editing is authorship, not access: a workspace owner may remove
        // someone's amendment but may never put different words in their mouth.
        if (String(amendment.user) !== String(req.user?.id)) {
            return res
                .status(403)
                .json({ message: "You can only edit your own amendments" });
        }

        if (amendment.message !== text) {
            amendment.message = text;
            amendment.edited = true;
            await amendment.save();
        }

        await amendment.populate("user", AUTHOR_FIELDS);

        res.status(200).json({ message: "Amendment saved successfully", amendment });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const deleteAmendment = async (req: ModuleAccessRequest, res: Response) => {
    try {
        const { amendmentId } = req.params;

        const amendment = await Comment.findById(amendmentId);

        if (!amendment || amendment.isDeleted) {
            return res.status(404).json({ message: "Amendment not found" });
        }

        const isAuthor = String(amendment.user) === String(req.user?.id);

        // requireModuleAccess already put the caller's workspace role on the
        // request, so moderating someone else's amendment costs no extra lookup.
        if (!isAuthor && !isWorkspaceManager(req.moduleAccess?.role as any)) {
            return res
                .status(403)
                .json({ message: "You can only delete your own amendments" });
        }

        amendment.isDeleted = true;
        await amendment.save();

        /**
         * Replies are NOT deleted with their parent.
         *
         * They are other people's words, and cascading meant the author of a
         * root amendment could wipe a colleague's reply by tidying up their
         * own — silent destruction of content the deleter never wrote. It also
         * made the tombstone in getRecordAmendments unreachable: nothing could
         * ever be a deleted-parent-with-a-live-reply, because the cascade had
         * just deleted the reply. The thread now stays readable, headed by
         * "This amendment was deleted."
         */

        const record = await Record.findById(amendment.record).select("name collectionName");

        await touchWorkspace(amendment.workspace);

        await logActivity({
            workspace: amendment.workspace,
            user: req.user?.id,
            action: "comment_deleted",
            module: amendment.module,
            collectionName: record?.collectionName,
            record: amendment.record,
            targetName: record?.name,
            before: amendment.message,
            after: null,
            message: `deleted an amendment on "${record?.name ?? "a record"}"`
        });

        res.status(200).json({ message: "Amendment deleted successfully" });
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};
