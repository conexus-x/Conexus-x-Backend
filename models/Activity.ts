import mongoose, { Document, Model, Schema } from "mongoose";

export interface IActivity extends Document {
  workspace: mongoose.Types.ObjectId;

  board?: mongoose.Types.ObjectId;

  item?: mongoose.Types.ObjectId;

  user: mongoose.Types.ObjectId;

  action:
    | "workspace_created"
    | "workspace_updated"
    | "member_invited"
    | "member_removed"
    | "board_created"
    | "board_updated"
    | "board_deleted"
    | "group_created"
    | "group_updated"
    | "item_created"
    | "item_updated"
    | "item_deleted"
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

    board: {
      type: Schema.Types.ObjectId,
      ref: "Board",
    },

    item: {
      type: Schema.Types.ObjectId,
      ref: "Item",
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
        "board_created",
        "board_updated",
        "board_deleted",
        "group_created",
        "group_updated",
        "item_created",
        "item_updated",
        "item_deleted",
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
ActivitySchema.index({ user: 1 });
ActivitySchema.index({ board: 1 });
ActivitySchema.index({ item: 1 });

const Activity: Model<IActivity> =
  mongoose.models.Activity ||
  mongoose.model<IActivity>("Activity", ActivitySchema);

export default Activity;