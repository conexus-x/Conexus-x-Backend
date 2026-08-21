// models/User.ts

import mongoose, { Document, Model, Schema } from "mongoose";

export interface IUser extends Document {
  firstName: string;
  lastName?: string;
  email: string;
  password?: string;
  avatar?: string;
  avatarPublicId?: string;
  phone?: string;
  apiKey?: string;
  googleId?: string;
  authProvider: "local" | "google";

  emailVerified: boolean;
  isActive: boolean;

  lastLogin?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    lastName: {
      type: String,
      required: function (this: IUser) {
        return this.authProvider === "local";
      },
      trim: true,
      maxlength: 50,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: function (this: IUser) {
        return this.authProvider === "local";
      },
      minlength: 8,
    },

    googleId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },

    avatar: {
      type: String,
      default: "",
    },

    // Cloudinary public_id for `avatar` — needed to delete or replace the asset.
    avatarPublicId: {
      type: String,
      default: "",
    },

    phone: {
      type: String,
      default: "",
    },

    apiKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastLogin: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);


const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);

export default User;