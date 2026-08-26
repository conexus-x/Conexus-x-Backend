// models/User.ts

import mongoose, { Document, Model, Schema } from "mongoose";

/**
 * The presence choices the picker offers, mirrored client-side in
 * app/lib/presence.ts — change both together. "offline" is the deliberate
 * "appear offline", not a derived state.
 */
export const USER_STATUSES = [
  "online",
  "busy",
  "dnd",
  "away",
  "offline",
] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Built-in, non-human accounts.
 *
 * They exist so the audit trail can say WHAT did something rather than
 * attributing a machine's work to whichever person happened to trigger it.
 * A bot has no password, cannot sign in (isActive: false blocks `protect`),
 * and is never returned by member listings.
 *
 * "announcer" is reserved but not built yet — the intended use is one message
 * addressed to every member at once instead of a per-person send.
 */
export const SYSTEM_USER_KEYS = ["automation", "announcer"] as const;

export type SystemUserKey = (typeof SYSTEM_USER_KEYS)[number];

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

  /**
   * A built-in actor rather than a person — see utils/systemUsers.ts.
   *
   * Null on every real account. Set, it is BOTH the marker and the key: it is
   * unique, so get-or-create can never race two "Automation" bots into
   * existence, and it is what the seeder looks a bot up by rather than
   * matching on a display name someone could change.
   */
  systemKey?: SystemUserKey | null;

  emailVerified: boolean;
  isActive: boolean;

  /** What the user picked in the status menu — a preference, not a fact. */
  status: UserStatus;
  /** Bumped by the presence heartbeat; a stale value means the pick expired. */
  lastSeen?: Date;

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

    systemKey: {
      type: String,
      enum: SYSTEM_USER_KEYS,
      // `sparse` matters: without it every real user would collide on null.
      unique: true,
      sparse: true,
      default: null,
    },

    status: {
      type: String,
      enum: USER_STATUSES,
      default: "online",
    },

    lastSeen: {
      type: Date,
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