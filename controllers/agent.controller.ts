// controllers/agent.controller.ts

import { Request, Response } from "express";
import {
    AgentTurn,
    isAgentConfigured,
    runAgent,
    runAuthorised
} from "../services/agent.service";
import type { PendingAction } from "../services/agentTools.service";
import {
    chargeUsd,
    checkSpend,
    getBalance
} from "../services/aiCredits.service";

interface AuthRequest extends Request {
    user?: { id: string };
}

/**
 * Hard ceiling on turns accepted from the client, whatever the plan says.
 *
 * The per-message and per-history limits are now the PLAN's (see
 * services/aiCredits.service.ts) — they are pure input cost, so trimming them
 * is the one limit that makes a turn cheaper without making it worse. This
 * stays as the outer bound nobody can exceed.
 */
const MAX_TURNS = 12;

// POST /api/agent/chat  { messages: [{role, content}], workspaceId?, moduleId? }
export const chatWithAgent = async (req: AuthRequest, res: Response) => {

    try {

        if (!isAgentConfigured()) {
            return res.status(503).json({
                message: "Aquiline is not configured — set ANTHROPIC_API_KEY and restart."
            });
        }

        const { messages, workspaceId, moduleId } = req.body ?? {};

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ message: "messages is required" });
        }

        const userId = String(req.user?.id ?? "");

        /**
         * The budget gate, BEFORE the model call.
         *
         * This is the only place that can actually stop money being spent —
         * once the request is away, it is billed whatever we do with the
         * answer. 402 rather than 403: the request was allowed, the account
         * simply cannot pay for it, and the client keys its upgrade prompt off
         * that distinction.
         */
        const spend = await checkSpend(userId);

        if (!spend) {
            return res.status(404).json({ message: "User not found" });
        }

        if (!spend.ok) {
            return res.status(402).json({
                message: spend.reason,
                credits: spend.balance
            });
        }

        const history: AgentTurn[] = messages
            .slice(-MAX_TURNS)
            .filter(
                (turn: unknown) =>
                    typeof (turn as AgentTurn)?.content === "string" &&
                    ["user", "assistant"].includes((turn as AgentTurn)?.role)
            )
            .map((turn: AgentTurn) => ({
                role: turn.role,
                content: String(turn.content).slice(0, spend.spec.maxChars)
            }));

        if (history.length === 0 || history[history.length - 1].role !== "user") {
            return res.status(400).json({ message: "The last message must be from the user" });
        }

        const reply = await runAgent(
            // The plan decides how much history is replayed: it is re-billed in
            // full on every request, so this is the cheapest real lever there is.
            history.slice(-spend.spec.historyTurns),
            {
                userId,
                workspaceId: workspaceId ? String(workspaceId) : undefined,
                moduleId: moduleId ? String(moduleId) : undefined
            }
        );

        /**
         * Charge what the turn ACTUALLY cost, not an estimate.
         *
         * After the call, and deliberately not inside runAgent: the service
         * reports usage, it does not own billing, and keeping the two apart is
         * what lets /confirm reuse the executor without paying twice.
         *
         * A failure to record the charge must not lose the user their answer —
         * they were billed by Anthropic either way, and returning a 500 here
         * would spend the money and show them nothing. It is logged instead.
         */
        let credits = spend.balance;

        try {
            credits = (await chargeUsd(userId, reply.usage.costUsd)) ?? credits;
        } catch (chargeError: any) {
            console.error("Agent credit charge failed:", {
                userId,
                costUsd: reply.usage.costUsd,
                message: chargeError?.message
            });
        }

        return res.json({ ...reply, credits });

    } catch (error: any) {

        const status = Number(error?.status);

        /**
         * Logged in full server-side — a single generic string in the panel is
         * a debugging dead end. The provider's error BODY still never reaches
         * the client: it can echo back the request, which includes CRM data.
         */
        console.error("Agent error:", {
            status: status || undefined,
            name: error?.name,
            message: error?.message,
            provider: error?.error?.error?.message
        });

        if (status === 401 || status === 403) {
            return res.status(503).json({
                message: "Aquiline key was rejected by Anthropic — check ANTHROPIC_API_KEY."
            });
        }

        if (status === 429) {
            return res.status(429).json({
                message: "Rate limited by Anthropic — wait a moment and try again."
            });
        }

        if (status === 400) {
            // Ours to fix, not the user's: a malformed request means the loop
            // built something the API rejected.
            return res.status(502).json({
                message: "Aquiline built a bad request — see the server log for the reason."
            });
        }

        if (status === 402) {
            return res.status(402).json({
                message: "Anthropic credit exhausted — top up to keep using Aquiline."
            });
        }

        if (status >= 500) {
            return res.status(502).json({
                message: "Anthropic is having trouble — try again shortly."
            });
        }

        return res.status(500).json({
            message: "Aquiline hit an unexpected error — see the server log."
        });

    }

};


// POST /api/agent/confirm  { pending, workspaceId?, moduleId? }
/**
 * The user pressed Authorise.
 *
 * No model call: the pending action was decided last turn, so this replays it
 * straight through the executor — free, and it cannot drift into doing
 * something else. The client sends the payload back, which is safe because the
 * executor re-checks membership and module access for the caller; nobody gains
 * reach they did not already have by clicking.
 */
export const confirmAgentAction = async (req: AuthRequest, res: Response) => {

    try {

        const { pending, workspaceId, moduleId } = req.body ?? {};

        if (!pending?.tool || typeof pending.tool !== "string" || !pending.input) {
            return res.status(400).json({ message: "Nothing to authorise" });
        }

        const userId = String(req.user?.id ?? "");

        const reply = await runAuthorised(pending as PendingAction, {
            userId,
            workspaceId: workspaceId ? String(workspaceId) : undefined,
            moduleId: moduleId ? String(moduleId) : undefined
        });

        // NOT charged: authorising replays a decision already paid for last
        // turn and makes no model call. The balance still rides along so every
        // agent response carries the same shape and the panel never has to ask
        // which kind of reply it is holding.
        const credits = await getBalance(userId);

        return res.json({ ...reply, credits });

    } catch (error: any) {

        console.error("Agent confirm error:", error?.message);

        return res.status(400).json({
            message: error?.message ?? "Could not complete that action."
        });

    }

};


// GET /api/agent/credits
/**
 * What this account has left.
 *
 * Its own endpoint rather than only riding on a chat reply, because the panel
 * has to show the balance BEFORE the first message of a session — and because
 * the period can roll while a tab sits open, which nothing else would notice.
 */
export const getAgentCredits = async (req: AuthRequest, res: Response) => {

    try {

        const credits = await getBalance(String(req.user?.id ?? ""));

        if (!credits) {
            return res.status(404).json({ message: "User not found" });
        }

        return res.json({ credits });

    } catch (error: any) {

        console.error("Agent credits error:", error?.message);

        return res.status(500).json({ message: "Could not read your AI credits." });

    }

};
