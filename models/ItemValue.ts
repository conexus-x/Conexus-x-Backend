import mongoose, { Document, Model, Schema } from "mongoose";

export interface IItemValue extends Document {
  workspace: mongoose.Types.ObjectId;

  board: mongoose.Types.ObjectId;

  group: mongoose.Types.ObjectId;

  item: mongoose.Types.ObjectId;

  column: mongoose.Types.ObjectId;

  value: any;

  createdBy: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const ItemValueSchema = new Schema<IItemValue>(
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

    group: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: true,
      index: true,
    },

    item: {
      type: Schema.Types.ObjectId,
      ref: "Item",
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

ItemValueSchema.index({ workspace: 1 });
ItemValueSchema.index({ board: 1 });
ItemValueSchema.index({ group: 1 });
ItemValueSchema.index({ item: 1 });
ItemValueSchema.index({ column: 1 });
ItemValueSchema.index({ createdBy: 1 });
ItemValueSchema.index({ item: 1, column: 1 }, { unique: true });

const ItemValue: Model<IItemValue> =
  mongoose.models.ItemValue ||
  mongoose.model<IItemValue>("ItemValue", ItemValueSchema);

export default ItemValue;