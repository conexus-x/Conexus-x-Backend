// services/aiCredits.service.ts

import User, { ACCOUNT_PLANS, AccountPlan, IUser } from "../models/User";
import env from "../config/env";

/**
 * Who may spend how much on Aquiline, and how much they have left.
 *
 * THE UNIT IS A CREDIT, AND ONE CREDIT IS $0.0001 (a hundredth of a cent).
 *
 * Money is what actually runs out — the Anthropic key is one shared pot and
 * the whole budget is $5 — so the ledger has to be denominated in it. Counting
 * MESSAGES instead would have been friendlier to read and wrong: a "hi" and a
 * create_blueprint that runs four tool rounds differ by more than an order of
 * magnitude, so a message quota either starves the cheap case or fails to
 * contain the expensive one.
 *
 * Integers, not floats. A balance decremented by 0.0035 a few hundred times
 * accumulates real drift, and this is the one number in the app that must not
 * be approximately right. A typical Haiku turn lands around 30-40 credits,
 * which is also why the unit is this size: allowances stay readable 3-4 digit
 * numbers rather than either decimals or millions.
 *
 * This module is the ONLY place that knows the plan rules. The controller asks
 * it two questions — may this person spend, and here is what they spent — and
 * has no opinions of its own.
 */

/** $1 buys this many credits. Used both ways: cost -> credits, credits -> cost. */
export const CREDITS_PER_USD = 10_000;

export interface PlanSpec {
    plan: AccountPlan;
    label: string;
    /** Credits granted at the start of every period. */
    allowance: number;
    /**
     * How many past turns are replayed to the model.
     *
     * A per-plan knob because history is pure INPUT cost, re-billed in full on
     * every request — trimming it is the one limit that makes a turn cheaper
     * without making it worse at its job.
     */
    historyTurns: number;
    /** Longest single message accepted, in characters. A wall of text is billed. */
    maxChars: number;
}

/**
 * The plans, as a spec table.
 *
 * Allowances are read from env so they can be tuned against the real bill
 * without a deploy or a migration — which is also why the allowance lives HERE
 * and not on each user document: changing the free tier must not mean
 * rewriting every free row.
 *
 * The defaults are sized against a $5 total budget: free is $0.05 a month
 * (about 14 turns), paid $1.00 (about 280), enterprise $5.00 (about 1400).
 *
 * NOTE what is NOT limited per plan: max_tokens on the reply. It was tempting,
 * and it is a trap — the ceiling was raised from 400 to 2000 precisely because
 * a smaller one truncated create_blueprint mid-JSON, so the tool call never
 * completed and the turn died confusingly. A free user would have hit exactly
 * that. The honest limit is the budget, not a model crippled into failing in a
 * way the user cannot understand.
 */
export const PLANS: Record<AccountPlan, PlanSpec> = {
    free: {
        plan: "free",
        label: "Free",
        allowance: Number(env.ai_credits_free ?? 500),
        historyTurns: 4,
        maxChars: 500
    },
    paid: {
        plan: "paid",
        label: "Paid",
        allowance: Number(env.ai_credits_paid ?? 10_000),
        historyTurns: 6,
        maxChars: 1000
    },
    enterprise: {
        plan: "enterprise",
        label: "Enterprise",
        allowance: Number(env.ai_credits_enterprise ?? 50_000),
        historyTurns: 8,
        maxChars: 2000
    }
};

export function planSpec(plan?: AccountPlan | null): PlanSpec {
    // An unknown or missing plan is treated as free rather than rejected: rows
    // that predate this feature must keep working, and the safe default when
    // we cannot tell who is paying is the cheapest one.
    return PLANS[(plan as AccountPlan) ?? "free"] ?? PLANS.free;
}

export interface CreditBalance {
    plan: AccountPlan;
    planLabel: string;
    /** Credits for the current period — the override if set, else the plan's. */
    allowance: number;
    used: number;
    remaining: number;
    /** When `used` returns to zero. */
    resetAt: Date;
    /** Convenience for the UI, so it never has to know CREDITS_PER_USD. */
    remainingUsd: number;
    exhausted: boolean;
}

/** Exact credits for a turn, ALWAYS rounded up — never bill ourselves short. */
export function creditsForUsd(costUsd: number): number {
    if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
    return Math.ceil(costUsd * CREDITS_PER_USD);
}

/** One calendar month on from `from`. */
function nextPeriodEnd(from: Date): Date {
    const end = new Date(from);
    end.setMonth(end.getMonth() + 1);
    return end;
}

/**
 * Rolls the period if it has lapsed, and returns the user with fresh counters.
 *
 * LAZY, not a cron. A scheduled job to reset every account would be a moving
 * part that can fail silently and leave people locked out of something they
 * paid for; doing it on the read that needs it cannot drift, needs no
 * scheduler, and costs one conditional update on the first call of a period.
 *
 * The filter carries `aiCredits.periodEnd: { $lte: now }`, so two concurrent
 * requests cannot both reset — the second matches nothing and reads the row
 * the first already wrote.
 */
async function ensurePeriod(userId: string): Promise<IUser | null> {
    const now = new Date();

    const rolled = await User.findOneAndUpdate(
        { _id: userId, "aiCredits.periodEnd": { $lte: now } },
        {
            $set: {
                "aiCredits.used": 0,
                "aiCredits.periodStart": now,
                "aiCredits.periodEnd": nextPeriodEnd(now)
            }
        },
        // returnDocument, not `new: true` — mongoose deprecated the latter and
        // warns on every call, and this runs on the hot path of every turn.
        { returnDocument: "after" }
    );

    if (rolled) return rolled;

    const user = await User.findById(userId);
    if (!user) return null;

    // A row created before this feature shipped has no counters at all. Give it
    // them now rather than treating a missing object as zero everywhere — the
    // rest of this module can then assume the shape exists.
    if (!user.aiCredits?.periodEnd) {
        user.aiCredits = {
            used: user.aiCredits?.used ?? 0,
            allowanceOverride: user.aiCredits?.allowanceOverride ?? null,
            periodStart: now,
            periodEnd: nextPeriodEnd(now),
            lifetimeCredits: user.aiCredits?.lifetimeCredits ?? 0,
            lastUsedAt: user.aiCredits?.lastUsedAt ?? null
        };
        await user.save();
    }

    return user;
}

function balanceOf(user: IUser): CreditBalance {
    const spec = planSpec(user.plan);

    // The override is what makes an enterprise deal possible without inventing
    // a fourth plan for every negotiated number.
    const allowance = Math.max(
        0,
        Number(user.aiCredits?.allowanceOverride ?? spec.allowance)
    );

    const used = Math.max(0, Number(user.aiCredits?.used ?? 0));
    const remaining = Math.max(0, allowance - used);

    return {
        plan: spec.plan,
        planLabel: spec.label,
        allowance,
        used,
        remaining,
        resetAt: user.aiCredits?.periodEnd ?? nextPeriodEnd(new Date()),
        remainingUsd: Number((remaining / CREDITS_PER_USD).toFixed(4)),
        exhausted: remaining <= 0
    };
}

/** What this person has left, rolling the period first if it has lapsed. */
export async function getBalance(userId: string): Promise<CreditBalance | null> {
    const user = await ensurePeriod(userId);
    return user ? balanceOf(user) : null;
}

export interface SpendCheck {
    ok: boolean;
    balance: CreditBalance;
    spec: PlanSpec;
    /** Set when ok is false — shown to the user verbatim. */
    reason?: string;
}

/**
 * May this person start a turn?
 *
 * Checked BEFORE the model call, because the only way to not spend money is to
 * not make the request. The cost of a turn is unknowable in advance, so the
 * test is simply "has anything left" — which means a turn that starts with 1
 * credit can finish 40 in the red. That overrun is bounded by one turn per
 * user and is the deliberate trade: the alternative is refusing to start until
 * a worst-case reserve is free, which would strand people on a balance they
 * could have spent.
 */
export async function checkSpend(userId: string): Promise<SpendCheck | null> {
    const user = await ensurePeriod(userId);
    if (!user) return null;

    const balance = balanceOf(user);
    const spec = planSpec(user.plan);

    if (balance.exhausted) {
        const when = balance.resetAt.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric"
        });

        return {
            ok: false,
            balance,
            spec,
            reason:
                balance.plan === "free"
                    ? `You have used all ${balance.allowance} AI credits on the Free plan. They reset on ${when} — or upgrade for more.`
                    : `You have used all ${balance.allowance} AI credits for this period. They reset on ${when}.`
        };
    }

    return { ok: true, balance, spec };
}

/**
 * Records what a finished turn actually cost.
 *
 * $inc, never read-modify-write: two turns finishing at the same moment would
 * otherwise each read the same `used` and write back the same total, and one
 * of them would be free. This is the reason the whole ledger is integers on
 * one document rather than a computed sum.
 *
 * A zero cost still writes nothing but is not an error — /agent/confirm runs a
 * previously-decided action with no model call, and charging for that would be
 * charging twice for one decision.
 */
export async function chargeUsd(
    userId: string,
    costUsd: number
): Promise<CreditBalance | null> {
    const credits = creditsForUsd(costUsd);

    if (credits <= 0) return getBalance(userId);

    const user = await User.findByIdAndUpdate(
        userId,
        {
            $inc: {
                "aiCredits.used": credits,
                "aiCredits.lifetimeCredits": credits
            },
            $set: { "aiCredits.lastUsedAt": new Date() }
        },
        // returnDocument, not `new: true` — mongoose deprecated the latter and
        // warns on every call, and this runs on the hot path of every turn.
        { returnDocument: "after" }
    );

    return user ? balanceOf(user) : null;
}

/**
 * Moves an account onto a plan AND starts a fresh period.
 *
 * The reset is the whole reason this exists rather than writing `plan`
 * directly. Without it the period's `used` carries across the change, so
 * someone who spent their 500 free credits and then upgraded would receive
 * 9,500 of the 10,000 they just paid for — defensible arithmetic and an
 * indefensible thing to explain to a customer. Upgrading buys a month, so it
 * starts one.
 *
 * Whatever wires up billing should call THIS, never $set the field.
 *
 * `lifetimeCredits` is untouched, as it is by the ordinary period roll: it is
 * the one counter that answers "how much has this account ever cost us".
 */
export async function setPlan(
    userId: string,
    plan: AccountPlan,
    allowanceOverride?: number | null
): Promise<CreditBalance | null> {
    if (!ACCOUNT_PLANS.includes(plan)) {
        throw new Error(`Unknown plan "${plan}"`);
    }

    const now = new Date();

    const update: Record<string, unknown> = {
        plan,
        "aiCredits.used": 0,
        "aiCredits.periodStart": now,
        "aiCredits.periodEnd": nextPeriodEnd(now)
    };

    // undefined means "leave it alone"; null means "clear it back to the
    // plan's own allowance". They are different instructions and collapsing
    // them would make an override impossible to remove.
    if (allowanceOverride !== undefined) {
        update["aiCredits.allowanceOverride"] = allowanceOverride;
    }

    const user = await User.findByIdAndUpdate(
        userId,
        { $set: update },
        { returnDocument: "after" }
    );

    return user ? balanceOf(user) : null;
}

/** Every plan, for a pricing or admin screen. */
export function listPlans(): PlanSpec[] {
    return ACCOUNT_PLANS.map((plan) => PLANS[plan]);
}
