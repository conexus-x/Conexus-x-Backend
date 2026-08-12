import mongoose, { Document, Model, Schema } from "mongoose";

export interface IRecord extends Document {
  workspace: mongoose.Types.ObjectId;
  module: mongoose.Types.ObjectId;
  collectionName: mongoose.Types.ObjectId;
  name: string;
  position: number;
  createdBy: mongoose.Types.ObjectId;
  isCompleted: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RecordSchema = new Schema<IRecord>(
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
      required: true,
      index: true,
    },

    collectionName: {
      type: Schema.Types.ObjectId,
      ref: "Collection",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    position: {
      type: Number,
      default: 0,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    isCompleted: {
      type: Boolean,
      default: false,
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


RecordSchema.index({ createdBy: 1 });
RecordSchema.index({ module: 1, collectionName: 1, position: 1 });

const Record: Model<IRecord> =
  mongoose.models.Record ||
  mongoose.model<IRecord>("Record", RecordSchema);

export default Record;