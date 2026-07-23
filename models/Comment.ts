import mongoose, { Document, Model, Schema } from "mongoose";

export interface IComment extends Document {
  workspace: mongoose.Types.ObjectId;

  board: mongoose.Types.ObjectId;

  item: mongoose.Types.ObjectId;

  user: mongoose.Types.ObjectId;

  message: string;

  parentComment?: mongoose.Types.ObjectId;

  edited: boolean;

  isDeleted: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const CommentSchema = new Schema<IComment>(
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
      required: true,
      index: true,
    },

    item: {
      type: Schema.Types.ObjectId,
      ref: "Item",
      required: true,
      index: true,
    },

    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    parentComment: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },

    edited: {
      type: Boolean,
      default: false,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
CommentSchema.index({ item: 1, createdAt: -1 });
CommentSchema.index({ user: 1 });

const Comment: Model<IComment> =
  mongoose.models.Comment ||
  mongoose.model<IComment>("Comment", CommentSchema);

export default Comment;