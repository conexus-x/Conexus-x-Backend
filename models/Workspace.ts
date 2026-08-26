import mongoose, { Document, Model, Schema } from "mongoose";

export interface IWorkspace extends Document {
    name: string;
    slug: string;
    owner: mongoose.Types.ObjectId;
    logo?: string;
    description?: string;

    /**
     * Which icon represents this workspace, as a KEY from the client's catalog
     * (app/lib/workspaceIcons.tsx) — never a class name, a URL or an emoji.
     *
     * A key means the rendering stays the client's business: the icon set can be
     * restyled or swapped without a migration, and an unknown key falls back
     * rather than rendering something broken. Empty means "not chosen".
     */
    icon?: string;
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
        icon: {
            type: String,
            trim: true,
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