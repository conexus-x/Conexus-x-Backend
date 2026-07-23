import mongoose, { Document, Model, Schema } from "mongoose";

export interface IApiToken extends Document {
  workspace: mongoose.Types.ObjectId;

  user: mongoose.Types.ObjectId;

  name: string;

  tokenHash: string;

  permissions: string[];

  lastUsedAt?: Date;

  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const ApiTokenSchema = new Schema<IApiToken>(
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

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },

    permissions: {
      type: [String],
      default: ["*"],
    },

    lastUsedAt: {
      type: Date,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

ApiTokenSchema.index({ workspace: 1 });
ApiTokenSchema.index({ user: 1 });
ApiTokenSchema.index({ tokenHash: 1 });

const ApiToken: Model<IApiToken> =
  mongoose.models.ApiToken ||
  mongoose.model<IApiToken>("ApiToken", ApiTokenSchema);

export default ApiToken;