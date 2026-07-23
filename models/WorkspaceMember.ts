import mongoose, { Document, Model, Schema } from "mongoose";

export interface IWorkspaceMember extends Document {
  workspace: mongoose.Types.ObjectId | string;
  user: mongoose.Types.ObjectId | string;

  role: "owner" | "admin" | "member" | "guest";

  status: "active" | "pending" | "inactive";

  invitedBy?: mongoose.Types.ObjectId | string;

  joinedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceMemberSchema = new Schema<IWorkspaceMember>(
  {
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

    role: {
      type: String,
      enum: ["owner", "admin", "member", "guest"],
      default: "member",
    },

    status: {
      type: String,
      enum: ["active", "pending", "inactive"],
      default: "active",
    },

    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// A user can only exist once per workspace
WorkspaceMemberSchema.index(
  { workspace: 1, user: 1 },
  { unique: true }
);

const WorkspaceMember: Model<IWorkspaceMember> =
  mongoose.models.WorkspaceMember ||
  mongoose.model<IWorkspaceMember>(
    "WorkspaceMember",
    WorkspaceMemberSchema
  );

export default WorkspaceMember;