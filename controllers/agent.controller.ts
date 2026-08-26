// controllers/agent.controller.ts

import { Request, Response } from "express";
import {
    AgentTurn,
    isAgentConfigured,
    runAgent,
    runAuthorised
} from "../services/agent.service";
import type { PendingAction } from "../services/agentTools.service";

interface AuthRequest extends Request {
    user?: { id: string };
}

/** Cheap guard: a wall of text is a wall of billed tokens. */
const MAX_CHARS = 1000;
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

        const history: AgentTurn[] = messages
            .slice(-MAX_TURNS)
            .filter(
                (turn: unknown) =>
                    typeof (turn as AgentTurn)?.content === "string" &&
                    ["user", "assistant"].includes((turn as AgentTurn)?.role)
            )
            .map((turn: AgentTurn) => ({
                role: turn.role,
                content: String(turn.content).slice(0, MAX_CHARS)
            }));

        if (history.length === 0 || history[history.length - 1].role !== "user") {
            return res.status(400).json({ message: "The last message must be from the user" });
        }

        const reply = await runAgent(history, {
            userId: String(req.user?.id ?? ""),
            workspaceId: workspaceId ? String(workspaceId) : undefined,
            moduleId: moduleId ? String(moduleId) : undefined
        });

        return res.json(reply);

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

        const reply = await runAuthorised(pending as PendingAction, {
            userId: String(req.user?.id ?? ""),
            workspaceId: workspaceId ? String(workspaceId) : undefined,
            moduleId: moduleId ? String(moduleId) : undefined
        });

        return res.json(reply);

    } catch (error: any) {

        console.error("Agent confirm error:", error?.message);

        return res.status(400).json({
            message: error?.message ?? "Could not complete that action."
        });

    }

};
