/**
 * Put an account on a plan.
 *
 *   npx ts-node scripts/set_plan.ts <email> <free|paid|enterprise> [allowance]
 *
 * This exists because there is NO billing integration yet: plans are set by
 * hand, and "set by hand" without a script means someone editing Mongo
 * directly and forgetting to reset the period — which silently shortchanges
 * the person who just upgraded. It goes through setPlan() for exactly that
 * reason.
 *
 * The optional third argument is a per-account allowance override, for an
 * enterprise number that does not match the standard tier. Pass "clear" to
 * remove one.
 */

import mongoose from "mongoose";
const env = require("../config/env");
import User, { ACCOUNT_PLANS, AccountPlan } from "../models/User";
import { setPlan, planSpec } from "../services/aiCredits.service";

async function main() {
    const [email, plan, allowanceArg] = process.argv.slice(2);

    if (!email || !plan) {
        console.error("Usage: set_plan.ts <email> <free|paid|enterprise> [allowance|clear]");
        process.exit(1);
    }

    if (!ACCOUNT_PLANS.includes(plan as AccountPlan)) {
        console.error(`Unknown plan "${plan}". One of: ${ACCOUNT_PLANS.join(", ")}`);
        process.exit(1);
    }

    let override: number | null | undefined;

    if (allowanceArg === "clear") {
        override = null;
    } else if (allowanceArg !== undefined) {
        override = Number(allowanceArg);
        if (!Number.isFinite(override) || override < 0) {
            console.error(`Allowance must be a non-negative number, got "${allowanceArg}"`);
            process.exit(1);
        }
    }

    await mongoose.connect(String(env.mongo_url));

    const user = await User.findOne({ email: String(email).toLowerCase() });

    if (!user) {
        console.error(`No account for ${email}`);
        await mongoose.disconnect();
        process.exit(1);
    }

    const before = user.plan;

    const balance = await setPlan(String(user._id), plan as AccountPlan, override);

    const spec = planSpec(plan as AccountPlan);

    console.log(`${user.email}: ${before} -> ${plan}`);
    console.log(`  allowance   ${balance?.allowance} credits ($${((balance?.allowance ?? 0) / 10_000).toFixed(2)}/month)`);
    console.log(`  history     ${spec.historyTurns} turns replayed, ${spec.maxChars} chars per message`);
    console.log(`  period      reset, ends ${balance?.resetAt.toISOString().slice(0, 10)}`);
    console.log(`  lifetime    ${user.aiCredits?.lifetimeCredits ?? 0} credits used all-time (unchanged)`);

    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error("Failed:", error?.message ?? error);
    await mongoose.disconnect();
    process.exit(1);
});
