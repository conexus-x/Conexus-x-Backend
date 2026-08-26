// services/presence.service.ts

import { USER_STATUSES, UserStatus } from "../models/User";

/**
 * How long a heartbeat keeps a user "live". The client beats every 60s, so this
 * tolerates one missed beat before the picked status stops counting.
 */
export const PRESENCE_TIMEOUT_MS = 150 * 1000;

/** Shape any presence read needs — a lean doc satisfies it just as well. */
export interface PresenceSource {
    status?: UserStatus | string | null;
    lastSeen?: Date | string | null;
}

export const isUserStatus = (value: unknown): value is UserStatus =>
    typeof value === "string" && (USER_STATUSES as readonly string[]).includes(value);

/**
 * The status other people should see. `status` is only what the user picked —
 * it stays true while the heartbeat is fresh, and falls back to offline once the
 * tab is closed or backgrounded long enough. Picking "offline" wins outright,
 * which is how "appear offline" stays honest.
 */
export const effectiveStatus = (user: PresenceSource | null | undefined): UserStatus => {
    if (!user) return "offline";

    const picked: UserStatus = isUserStatus(user.status) ? user.status : "online";

    if (picked === "offline") return "offline";

    if (!user.lastSeen) return "offline";

    const lastSeen = new Date(user.lastSeen).getTime();

    if (Number.isNaN(lastSeen) || Date.now() - lastSeen > PRESENCE_TIMEOUT_MS) {
        return "offline";
    }

    return picked;
};
