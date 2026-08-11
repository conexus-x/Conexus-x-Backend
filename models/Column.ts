import mongoose, { Document, Model, Schema } from "mongoose";

export interface IColumn extends Document {
  board: mongoose.Types.ObjectId;

  name: string;

  type:
  | "text"
  | "number"
  | "status"
  | "date"
  | "person"
  | "email"
  | "phone"
  | "checkbox"
  | "dropdown"
  | "link"
  | "file"
  | "rating";

  options?: string[];

  width: number;

  position: number;

  isRequired: boolean;

  isHidden: boolean;

  createdBy: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const ColumnSchema = new Schema<IColumn>(
  {
    board: {
      type: Schema.Types.ObjectId,
      ref: "Board",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    type: {
      type: String,
      enum: [
        "text",
        "number",
        "status",
        "date",
        "person",
        "email",
        "phone",
        "checkbox",
        "dropdown",
        "link",
        "file",
        "rating",
      ],
      default: "text",
    },

    options: {
      type: [String],
      default: [],
    },

    width: {
      type: Number,
      default: 180,
    },

    position: {
      type: Number,
      default: 0,
    },

    isRequired: {
      type: Boolean,
      default: false,
    },

    isHidden: {
      type: Boolean,
      default: false,
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

ColumnSchema.index({ board: 1, position: 1 });
ColumnSchema.index({ createdBy: 1 });

const Column: Model<IColumn> =
  mongoose.models.Column ||
  mongoose.model<IColumn>("Column", ColumnSchema);

export default Column;