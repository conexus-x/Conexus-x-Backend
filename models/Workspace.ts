import mongoose, { Document, Model, Schema } from "mongoose";

export interface IWorkspace extends Document {
    name: string;
    slug: string;
    owner: mongoose.Types.ObjectId;
    logo?: string;
    description?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const WorkspaceSchema = new Schema<IWorkspace>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        owner: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        logo: {
            type: String,
            default: "",
        },
        description: {
            type: String,
            default: "",
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

const Workspace: Model<IWorkspace> =
    mongoose.models.Workspace ||
    mongoose.model<IWorkspace>("Workspace", WorkspaceSchema);

export default Workspace;