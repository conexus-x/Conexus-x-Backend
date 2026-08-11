import mongoose, { Document, Model, Schema } from "mongoose";

export interface IItem extends Document {
  workspace: mongoose.Types.ObjectId;
  board: mongoose.Types.ObjectId;
  group: mongoose.Types.ObjectId;
  name: string;
  position: number;
  createdBy: mongoose.Types.ObjectId;
  isCompleted: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ItemSchema = new Schema<IItem>(
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


ItemSchema.index({ createdBy: 1 });
ItemSchema.index({ board: 1, group: 1, position: 1 });

const Item: Model<IItem> =
  mongoose.models.Item ||
  mongoose.model<IItem>("Item", ItemSchema);

export default Item;