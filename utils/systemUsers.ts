import mongoose from "mongoose";
import User, { type SystemUserKey } from "../models/User";

/**
 * The built-in, non-human accounts.
 *
 * WHY THESE EXIST. Work done by the automation engine used to be logged
 * against the person whose edit set it off. That is true — they did cause it —
 * but it reads as though they moved five records by hand at 3am, and the one
 * fact a reader actually wants ("a rule did this, not a colleague") was only
 * recoverable from a badge. The bot is now the ACTOR; the person who triggered
 * it is kept on metadata.triggeredBy, so nothing is lost and the first thing
 * you read is the true one.
 *
 * A bot cannot sign in: it has no password and `isActive: false`, which is the
 * flag `protect` already rejects. It is not a workspace member either, so it
 * never appears in a roster or a person picker.
 *
 * ADDING ONE is a row in SYSTEM_USER_PROFILES plus its key in SYSTEM_USER_KEYS.
 * "announcer" is already reserved for the broadcast case — one message
 * addressed to every member at once rather than a send per person — and needs
 * no schema change when that gets built.
 */

interface SystemUserProfile {
    firstName: string;
    /** Never delivered to; unique so the User index is satisfied. */
    email: string;
}

const SYSTEM_USER_PROFILES: Record<SystemUserKey, SystemUserProfile> = {
    automation: {
        firstName: "Automation",
        email: "automation@system.crm.local"
    },
    announcer: {
        firstName: "Announcements",
        email: "announcements@system.crm.local"
    }
};

/**
 * Cached per process: this is called on the hot path of every automated write,
 * and the row it returns never changes.
 */
const cache = new Map<SystemUserKey, mongoose.Types.ObjectId>();

/**
 * The bot's id, creating it on first use.
 *
 * Uses an upsert keyed on `systemKey` rather than findOne-then-create, so two
 * concurrent automation runs on a cold process cannot both decide they are the
 * one that has to create it. The unique sparse index is the backstop.
 */
export async function systemUserId(
    key: SystemUserKey
): Promise<mongoose.Types.ObjectId | null> {
    const cached = cache.get(key);
    if (cached) return cached;

    try {
        const profile = SYSTEM_USER_PROFILES[key];

        const user = await User.findOneAndUpdate(
            { systemKey: key },
            {
                $setOnInsert: {
                    systemKey: key,
                    firstName: profile.firstName,
                    email: profile.email,
                    // Google, so the model's "password required for local" rule
                    // does not demand one. A bot has no credentials either way.
                    authProvider: "google",
                    emailVerified: true,
                    // The flag `protect` rejects — a bot can never hold a session.
                    isActive: false,
                    status: "offline"
                }
            },
            { upsert: true, returnDocument: "after" }
        )
            .select("_id")
            .lean();

        if (!user) return null;

        const id = new mongoose.Types.ObjectId(String(user._id));
        cache.set(key, id);
        return id;
    } catch (error) {
        /**
         * Never fatal. A missing bot must degrade to "logged against the
         * triggering user", which is what happened before bots existed — not
         * to a failed write.
         */
        console.error(
            `Could not resolve the "${key}" system user:`,
            (error as Error).message
        );
        return null;
    }
}

/** Members, pickers and rosters must never offer a bot. */
export const excludeSystemUsers = { systemKey: { $in: [null, undefined] } };
