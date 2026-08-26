import mongoose, { Document, Model, Schema } from "mongoose";

export interface IColumn extends Document {
  module: mongoose.Types.ObjectId;

  name: string;

  type:
  | "text"
  | "number"
  | "status"
  | "date"
  | "timeline"
  | "person"
  | "email"
  | "phone"
  | "checkbox"
  | "dropdown"
  | "link"
  | "file"
  | "rating"
  /** Links records on this module to records on another one. */
  | "relation"
  /** Shows a column's value FROM the linked records. Read-only, never stored. */
  | "reference";

  /**
   * Which grid this column belongs to.
   *
   *   record     the board's own columns
   *   subrecord  the columns every sub-record on this module is shown with
   *
   * Both live on the same module, which is why every read filters on it. Rows
   * written before sub-records existed have no `scope` at all, so the board
   * query matches "not subrecord" rather than "equals record".
   */
  scope: "record" | "subrecord";

  options?: string[];

  statusOptions?: {
    label: string;
    color: string;
  }[];

  /**
   * Per-type configuration. Only `relation` uses it:
   *
   *   targetModule  which module records may be linked from
   *   displayField  optional — a column on THAT module to show instead of the
   *                 linked record names. This is monday's mirror, folded into
   *                 the same column: you link first, then decide what to show.
   *   aggregate     how several linked records collapse into one cell
   *
   * The displayed value is never stored — services/reference.service.ts derives
   * it on read, which is why it stays correct when the source changes.
   *
   * `via` and `field` belong to the older standalone `reference` type. It is no
   * longer offered when adding a column, but existing ones keep resolving.
   */
  settings?: {
    targetModule?: mongoose.Types.ObjectId;
    /**
     * Which of the target module's two column sets `displayField` names.
     * "record" mirrors the linked record's own cell; "subrecord" mirrors the
     * cells of that record's CHILDREN, which is why it usually wants an
     * aggregate — one linked record can have many sub-records.
     */
    targetScope?: "record" | "subrecord";
    displayField?: mongoose.Types.ObjectId;
    via?: mongoose.Types.ObjectId;
    field?: mongoose.Types.ObjectId;
    aggregate?: "list" | "count" | "sum" | "avg" | "min" | "max";
  };

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
    module: {
      type: Schema.Types.ObjectId,
      ref: "Module",
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
        "timeline",
        "person",
        "email",
        "phone",
        "checkbox",
        "dropdown",
        "link",
        "file",
        "rating",
        "relation",
        "reference",
      ],
      default: "text",
    },

    scope: {
      type: String,
      enum: ["record", "subrecord"],
      default: "record",
      index: true,
    },

    options: {
      type: [String],
      default: [],
    },

    settings: {
      targetModule: { type: Schema.Types.ObjectId, ref: "Module" },
      targetScope: {
        type: String,
        enum: ["record", "subrecord"],
        default: "record"
      },
      displayField: { type: Schema.Types.ObjectId, ref: "Column" },
      via: { type: Schema.Types.ObjectId, ref: "Column" },
      field: { type: Schema.Types.ObjectId, ref: "Column" },
      aggregate: {
        type: String,
        enum: ["list", "count", "sum", "avg", "min", "max"],
        default: "list",
      },
    },

    statusOptions: {
      type: [
        {
          label: { type: String, required: true },
          color: { type: String, required: true },
        },
      ],
      default: undefined,
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

ColumnSchema.index({ module: 1, position: 1 });
ColumnSchema.index({ module: 1, scope: 1, position: 1 });
ColumnSchema.index({ createdBy: 1 });

const Column: Model<IColumn> =
  mongoose.models.Column ||
  mongoose.model<IColumn>("Column", ColumnSchema);

export default Column;