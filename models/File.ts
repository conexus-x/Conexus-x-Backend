import mongoose, { Document, Model, Schema } from "mongoose";

export interface IFile extends Document {
  workspace: mongoose.Types.ObjectId;

  uploadedBy: mongoose.Types.ObjectId;

  item?: mongoose.Types.ObjectId;

  comment?: mongoose.Types.ObjectId;

  name: string;

  originalName: string;

  url: string;

  publicId?: string;

  mimeType: string;

  size: number;

  type:
    | "image"
    | "document"
    | "video"
    | "other";

  isDeleted: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const FileSchema = new Schema<IFile>(
  {
    workspace: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },

    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    item: {
      type: Schema.Types.ObjectId,
      ref: "Item",
      index: true,
    },

    comment: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      index: true,
    },

    name: {
      type: String,
      required: true,
    },

    originalName: {
      type: String,
      required: true,
    },

    url: {
      type: String,
      required: true,
    },

    publicId: {
      type: String,
      default: "",
    },

    mimeType: {
      type: String,
      required: true,
    },

    size: {
      type: Number,
      required: true,
    },

    type: {
      type: String,
      enum: [
        "image",
        "document",
        "video",
        "other",
      ],
      default: "other",
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


FileSchema.index({ workspace: 1 });
FileSchema.index({ item: 1 });


const File: Model<IFile> =
  mongoose.models.File ||
  mongoose.model<IFile>("File", FileSchema);


export default File;