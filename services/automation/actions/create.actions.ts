import mongoose from "mongoose";
import RecordModel from "../../../models/Record";
import Collection from "../../../models/Collection";
import Module from "../../../models/Module";
import Comment from "../../../models/Comment";
import type { ActionHandler } from "../types";

/**
 * Actions that create something new — a record somewhere else, or an amendment
 * on this one.
 *
 * create_record is the only action that can write OUTSIDE the module the event
 * happened on, which is what makes cross-module recipes possible ("when a Deal
 * is won, open a Project"). It is therefore also the only one that has to check
 * where it is being pointed: the target collection must belong to the same
 * WORKSPACE as the recipe. Without that check a recipe would be a way to write
 * into a workspace the author cannot see.
 */

const createRecord: ActionHandler = async (ctx) => {
    const name = ctx.fill(ctx.action.value).trim().slice(0, 200);
    if (!name) return false;

    const targetCollectionId = ctx.action.targetCollection;
    if (!targetCollectionId) return false;

    const collection = await Collection.findById(targetCollectionId).lean();
    if (!collection) return false;

    /**
     * The workspace gate described above. A collection only knows its module,
     * so the workspace has to come from there — which is also the cheapest way
     * to confirm the module still exists before writing a record into it.
     */
    const targetModule = await Module.findById(collection.module)
        .select("workspace")
        .lean();

    if (!targetModule) return false;
    if (String(targetModule.workspace) !== String(ctx.automation.workspace)) return false;

    const last = await RecordModel.findOne({
        collectionName: collection._id,
        parentRecord: null
    }).sort({ position: -1 });

    const created = await RecordModel.create({
        workspace: targetModule.workspace,
        module: collection.module,
        collectionName: collection._id,
        parentRecord: null,
        name,
        position: last ? last.position + 1 : 0,
        createdBy: new mongoose.Types.ObjectId(String(ctx.event.user))
    });

    await ctx.log({
        action: "record_created",
        module: collection.module,
        collectionName: collection._id,
        record: created._id,
        targetName: name,
        after: name,
        message: `created record "${name}"`
    });

    return true;
};

const postAmendment: ActionHandler = async (ctx) => {
    const text = ctx.fill(ctx.action.value).trim();
    if (!text) return false;

    const amendment = await Comment.create({
        workspace: ctx.record.workspace,
        module: ctx.record.module,
        record: ctx.record._id,
        user: new mongoose.Types.ObjectId(String(ctx.event.user)),
        message: text
        // Left off on purpose: recipes post at the TOP level. A reply needs a
        // specific amendment to hang under, and nothing in a trigger names one.
        // (The field is `parentComment`, not `parentAmendment` — the route says
        // amendment but the model behind it is still Comment.)
    });

    await ctx.log({
        action: "comment_added",
        module: ctx.record.module,
        collectionName: ctx.record.collectionName,
        record: ctx.record._id,
        targetName: ctx.record.name,
        after: text,
        message: `posted an amendment on "${ctx.record.name}"`
    });

    return Boolean(amendment);
};

export const createActions: Record<string, ActionHandler> = {
    create_record: createRecord,
    post_amendment: postAmendment
};
