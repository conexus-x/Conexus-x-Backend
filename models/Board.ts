import mongoose, { Document, Model, Schema } from "mongoose";

export interface IBoard extends Document {
  workspace: mongoose.Types.ObjectId;

  name: string;
  description?: string;
  icon?: string;
  color?: string;
  visibility: "private" | "workspace" | "public";
  createdBy: mongoose.Types.ObjectId;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BoardSchema = new Schema<IBoard>(
  {
    workspace: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      default: "",
    },
    icon: {
      type: String,
      default: "📋",
    },
    color: {
      type: String,
      default: "#3B82F6",
    },
    visibility: {
      type: String,
      enum: ["private", "workspace", "public"],
      default: "workspace",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
BoardSchema.index({ createdBy: 1 });

const Board: Model<IBoard> =
  mongoose.models.Board ||
  mongoose.model<IBoard>("Board", BoardSchema);

export default Board;