import mongoose from "mongoose";
import dotenv from "dotenv";

import Module from "../models/Module";
import ModuleMember from "../models/ModuleMember";
import WorkspaceMember from "../models/WorkspaceMember";

dotenv.config();

/**
 * One-time migration for board-level access.
 *
 * Before this feature nothing was enforced: being in a workspace showed you
 * every board in it. The new rules (services/access.service.ts) keep that true
 * for members on workspace/public boards, but tighten two cases — so this script
 * writes the grants that preserve today's access exactly:
 *
 *   · every active MEMBER gets a grant on each PRIVATE board in their workspace
 *   · every active GUEST gets a grant on every board in their workspace
 *
 * Owners and admins need no rows; they always see everything.
 *
 * Run with --dry to print the plan without writing:
 *   npx ts-node scripts/backfill_module_access.ts --dry
 */

const MONGO_URI = process.env.MONGO_URI || "";
const DRY_RUN = process.argv.includes("--dry");

async function backfill() {
    if (!MONGO_URI) {
        console.error("MONGO_URI not found");
        process.exit(1);
    }

    await mongoose.connect(MONGO_URI);
    console.log(`Connected${DRY_RUN ? " (dry run — nothing will be written)" : ""}`);

    const modules = await Module.find({ isArchived: false })
        .select("_id workspace visibility")
        .lean();

    const memberships = await WorkspaceMember.find({ status: "active" })
        .select("workspace user role")
        .lean();

    const existing = await ModuleMember.find().select("module user").lean();

    const alreadyGranted = new Set(
        existing.map((grant) => `${String(grant.module)}:${String(grant.user)}`)
    );

    const modulesByWorkspace = new Map<string, typeof modules>();

    modules.forEach((moduleItem) => {
        const key = String(moduleItem.workspace);
        const list = modulesByWorkspace.get(key) ?? [];
        list.push(moduleItem);
        modulesByWorkspace.set(key, list);
    });

    const rows: {
        module: mongoose.Types.ObjectId;
        workspace: mongoose.Types.ObjectId;
        user: mongoose.Types.ObjectId;
    }[] = [];

    let skipped = 0;

    for (const membership of memberships) {
        const role = membership.role;

        if (role === "owner" || role === "admin") continue;

        const workspaceModules = modulesByWorkspace.get(String(membership.workspace)) ?? [];

        for (const moduleItem of workspaceModules) {
            const needsRow =
                role === "guest" || moduleItem.visibility === "private";

            if (!needsRow) continue;

            const key = `${String(moduleItem._id)}:${String(membership.user)}`;

            if (alreadyGranted.has(key)) {
                skipped += 1;
                continue;
            }

            alreadyGranted.add(key);

            rows.push({
                module: moduleItem._id as mongoose.Types.ObjectId,
                workspace: moduleItem.workspace as mongoose.Types.ObjectId,
                user: membership.user as mongoose.Types.ObjectId
            });
        }
    }

    console.log(
        `${modules.length} boards · ${memberships.length} active memberships`
    );
    console.log(`${rows.length} grants to write · ${skipped} already present`);

    if (DRY_RUN || rows.length === 0) {
        console.log(DRY_RUN ? "Dry run complete — nothing written." : "Nothing to do.");
        await mongoose.disconnect();
        process.exit(0);
    }

    // ordered:false so one pre-existing row cannot abort the rest.
    await ModuleMember.insertMany(rows, { ordered: false }).catch((error: any) => {
        if (error?.code !== 11000) throw error;
        console.log("Some rows already existed and were skipped.");
    });

    console.log("Backfill complete.");

    await mongoose.disconnect();
    process.exit(0);
}

backfill().catch(async (error) => {
    console.error("Backfill failed:", error);
    await mongoose.disconnect();
    process.exit(1);
});
