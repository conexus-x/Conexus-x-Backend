import mongoose, { Document, Model, Schema } from "mongoose";

export interface IRecordValue extends Document {
  workspace: mongoose.Types.ObjectId;

  module: mongoose.Types.ObjectId;

  collectionName: mongoose.Types.ObjectId;

  record: mongoose.Types.ObjectId;

  column: mongoose.Types.ObjectId;

  value: any;

  createdBy: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const RecordValueSchema = new Schema<IRecordValue>(
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

    record: {
      type: Schema.Types.ObjectId,
      ref: "Record",
      required: true,
      index: true,
    },

    column: {
      type: Schema.Types.ObjectId,
      ref: "Column",
      required: true,
      index: true,
    },

    value: {
      type: Schema.Types.Mixed,
      default: null,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

RecordValueSchema.index({ createdBy: 1 });
RecordValueSchema.index({ record: 1, column: 1 }, { unique: true });

const RecordValue: Model<IRecordValue> =
  mongoose.models.RecordValue ||
  mongoose.model<IRecordValue>("RecordValue", RecordValueSchema);

export default RecordValue;