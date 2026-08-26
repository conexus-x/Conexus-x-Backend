// models/ModuleMember.ts

import mongoose, { Document, Model, Schema } from "mongoose";

/**
 * A board-level access grant: this user may open this module.
 *
 * A grant is only ever needed on top of what the workspace role already opens
 * (see services/access.service.ts) — private boards, and anything at all for a
 * guest. Rows here are additive: there is no "deny" grant, so removing a row can
 * only take away access the row itself gave.
 */
export interface IModuleMember extends Document {
  module: mongoose.Types.ObjectId;

  /** Denormalised from the module so a workspace's grants read in one query. */
  workspace: mongoose.Types.ObjectId;

  user: mongoose.Types.ObjectId;

  grantedBy?: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const ModuleMemberSchema = new Schema<IModuleMember>(
  {
    module: {
      type: Schema.Types.ObjectId,
      ref: "Module",
      required: true,
      index: true,
    },

    workspace: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },

    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    grantedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// One grant per person per board.
ModuleMemberSchema.index({ module: 1, user: 1 }, { unique: true });

// The access panel reads every grant a person holds in one workspace.
ModuleMemberSchema.index({ workspace: 1, user: 1 });

const ModuleMember: Model<IModuleMember> =
  mongoose.models.ModuleMember ||
  mongoose.model<IModuleMember>("ModuleMember", ModuleMemberSchema);

export default ModuleMember;
