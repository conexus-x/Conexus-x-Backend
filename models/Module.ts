import mongoose, { Document, Model, Schema } from "mongoose";

export interface IModule extends Document {
  workspace: mongoose.Types.ObjectId;

  name: string;
  description?: string;
  icon?: string;
  color?: string;
  visibility: "private" | "workspace" | "public";

  /**
   * Free-form labels the team chooses, for grouping modules however they think
   * about them ("client", "q3", "archived-ish") rather than however the schema
   * does. Normalised on write — see sanitiseTags in module.controller.ts.
   *
   * Each carries its own colour, picked from the client's STATUS_SWATCHES. The
   * colour is stored as a HEX rather than a palette index, so re-ordering that
   * palette can never silently recolour everyone's existing tags.
   */
  tags: { label: string; color: string }[];
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
    tags: {
      type: [
        {
          _id: false,
          label: { type: String, required: true, trim: true },
          color: { type: String, required: true, trim: true },
        },
      ],
      default: [],
      // Indexed because "show me everything tagged X" is the whole point of
      // having them, and that filter runs over every module in a workspace.
      index: true,
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