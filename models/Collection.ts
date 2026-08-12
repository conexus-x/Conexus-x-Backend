import mongoose, { Document, Model, Schema } from "mongoose";

export interface ICollection extends Document {

    module: mongoose.Types.ObjectId;
    name: string;
    color?: string;
    position: number;
    createdBy: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;

}
const CollectionSchema = new Schema<ICollection>(
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
            maxlength: 100,
        },
        color: {
            type: String,
            default: "#3B82F6",
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
    },
    {
        timestamps: true,
    }
);


CollectionSchema.index({ createdBy: 1 });

const Collection: Model<ICollection> = mongoose.models.Collection || mongoose.model<ICollection>(
    "Collection",
    CollectionSchema
);
export default Collection;