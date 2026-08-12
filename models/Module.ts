import mongoose, { Document, Model, Schema } from "mongoose";

export interface IModule extends Document {
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

const ModuleSchema = new Schema<IModule>(
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
ModuleSchema.index({ createdBy: 1 });

const Module: Model<IModule> =
  mongoose.models.Module ||
  mongoose.model<IModule>("Module", ModuleSchema);

export default Module;