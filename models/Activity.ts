import mongoose, { Document, Model, Schema } from "mongoose";

export interface IActivity extends Document {
  workspace: mongoose.Types.ObjectId;

  module?: mongoose.Types.ObjectId;

  record?: mongoose.Types.ObjectId;

  user: mongoose.Types.ObjectId;

  action:
    | "workspace_created"
    | "workspace_updated"
    | "member_invited"
    | "member_removed"
    | "module_created"
    | "module_updated"
    | "module_deleted"
    | "collection_created"
    | "collection_updated"
    | "record_created"
    | "record_updated"
    | "record_deleted"
    | "column_created"
    | "column_updated"
    | "comment_added"
    | "comment_deleted"
    | "file_uploaded"
    | "login";

  message: string;

  metadata?: Record<string, any>;

  createdAt: Date;
  updatedAt: Date;
}

const ActivitySchema = new Schema<IActivity>(
  {
    workspace: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },

    module: {
      type: Schema.Types.ObjectId,
      ref: "Module",
    },

    record: {
      type: Schema.Types.ObjectId,
      ref: "Record",
    },

    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    action: {
      type: String,
      enum: [
        "workspace_created",
        "workspace_updated",
        "member_invited",
        "member_removed",
        "module_created",
        "module_updated",
        "module_deleted",
        "collection_created",
        "collection_updated",
        "record_created",
        "record_updated",
        "record_deleted",
        "column_created",
        "column_updated",
        "comment_added",
        "comment_deleted",
        "file_uploaded",
        "login",
      ],
      required: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
ActivitySchema.index({ workspace: 1, createdAt: -1 });
ActivitySchema.index({ module: 1 });
ActivitySchema.index({ record: 1 });

const Activity: Model<IActivity> =
  mongoose.models.Activity ||
  mongoose.model<IActivity>("Activity", ActivitySchema);

export default Activity;