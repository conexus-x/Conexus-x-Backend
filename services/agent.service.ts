// services/agent.service.ts

import Anthropic from "@anthropic-ai/sdk";
import env from "../config/env";
import {
    AGENT_TOOLS,
    AppliedAction,
    EntityRef,
    PendingAction,
    ToolContext,
    executeTool,
    isConfirmableTool
} from "./agentTools.service";

/**
 * Aquiline — the CRM agent.
 *
 * Deliberately not a thinker. It reads one instruction, calls the tools that
 * carry it out, and says what it did in a sentence. Anything longer is money
 * spent on prose instead of work, which is why:
 *
 *  - the model defaults to Haiku 4.5, the cheapest one that calls tools well;
 *  - thinking is left off entirely (this model would need budget_tokens, and a
 *    router does not need to deliberate);
 *  - max_tokens is a few hundred, so a rambling reply is impossible;
 *  - only the last few turns are sent, so a long chat does not re-bill history;
 *  - the loop is capped, so ONE message can never run away with the budget.
 *
 * The system prompt is the other half of that. It is short on purpose — every
 * word is re-sent and re-billed on every request in the conversation.
 */

const SYSTEM_PROMPT = [
    "You are Aquiline, the agent inside a CRM. You DO things; you do not muse.",
    "Hierarchy: workspace > module > collection > record. Columns belong to a module.",
    "Act immediately using the tools. Never describe what you are about to do.",
    "Use the ids in CONTEXT when the user says 'here' or 'this module'.",
    "Chain calls to finish a request in one turn (module, then collection, then records).",
    "Setting up a whole thing (\"a sales CRM\", \"order management\")? Decide the structure yourself and make ONE create_blueprint call with every module, collection, column and starter record. Do not ask what they want, and do not announce it — the user sees the plan and authorises it.",
    "Missing a name or a target? Ask one short question instead of guessing.",
    "Rename or edit with update_entity. NEVER delete and recreate to rename \u2014 it destroys the contents.",
    "Never ask permission in words. Call the tool \u2014 the app shows the user an Authorise button and runs it only if they press it.",
    "Deleting several things? ONE delete_entity call with ids, not one per thing.",
    "Reply in one plain sentence, past tense, naming what you made. No lists, no markdown, no preamble."
].join("\n");

/** Trimmed history: enough for a follow-up, not enough to re-bill a long chat. */
const HISTORY_TURNS = 6;

export interface AgentTurn {
    role: "user" | "assistant";
    content: string;
}

export interface AgentReply {
    text: string;
    actions: AppliedAction[];
    /** Set when the turn ended waiting on the user to authorise something. */
    pending?: PendingAction;
    /**
     * Every entity this turn touched or read, so the panel can render the names
     * in the reply as the badges they actually are. Never sent to the model.
     */
    mentions: EntityRef[];
    usage: {
        inputTokens: number;
        outputTokens: number;
        /** USD, from the model's published rate — shown so spend stays visible. */
        costUsd: number;
        steps: number;
    };
}

/** $ per million tokens. Anything unlisted falls back to Haiku's rate. */
const PRICING: Record<string, { input: number; output: number }> = {
    "claude-haiku-4-5": { input: 1, output: 5 },
    "claude-sonnet-5": { input: 3, output: 15 },
    "claude-opus-5": { input: 5, output: 25 }
};

export const isAgentConfigured = () => Boolean(env.anthropic_api_key);

/**
 * Collapse several pending calls into one prompt.
 *
 * Only same-tool, same-kind calls merge — anything else keeps the first and
 * lets the user come back for the rest, because one button must never stand for
 * two different kinds of change.
 */
const mergePending = (pendings: PendingAction[]): PendingAction | undefined => {
    if (pendings.length === 0) return undefined;
    if (pendings.length === 1) return pendings[0];

    const [first] = pendings;

    const sameShape = pendings.every(
        (item) => item.tool === first.tool && item.kind === first.kind
    );

    if (!sameShape || first.tool !== "delete_entity") return first;

    const targets = Array.from(
        new Set(pendings.flatMap((item) => item.targets ?? [item.name]).filter(Boolean))
    );

    return {
        tool: first.tool,
        kind: first.kind,
        name: `${targets.length} ${first.kind}s`,
        intent: `Delete ${targets.length} ${first.kind}s`,
        targets,
        input: { kind: first.kind, ids: targets }
    };
};

const client = () =>
    new Anthropic({ apiKey: env.anthropic_api_key as string });

/** One compact line beats a lookup call the user pays for. */
const contextLine = (context: ToolContext) => {
    const parts: string[] = [];
    if (context.workspaceId) parts.push(`workspaceId=${context.workspaceId}`);
    if (context.moduleId) parts.push(`moduleId=${context.moduleId}`);
    return parts.length ? `CONTEXT ${parts.join(" ")}` : "";
};

const textOf = (message: Anthropic.Message) =>
    message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join(" ")
        .trim();

export async function runAgent(
    history: AgentTurn[],
    context: ToolContext
): Promise<AgentReply> {

    const anthropic = client();

    const model = String(env.anthropic_model);
    const maxSteps = Math.max(1, Number(env.anthropic_max_steps) || 4);

    const recent = history.slice(-HISTORY_TURNS);

    const messages: Anthropic.MessageParam[] = recent.map((turn) => ({
        role: turn.role,
        content: turn.content
    }));

    // Where the user is standing, appended to the newest user turn rather than
    // pinned in the system prompt — it changes per page, and a system prompt
    // that changes would throw away the cached prefix on every request.
    const line = contextLine(context);
    const last = messages[messages.length - 1];

    if (line && last?.role === "user" && typeof last.content === "string") {
        last.content = `${last.content}\n${line}`;
    }

    const actions: AppliedAction[] = [];

    const pendings: PendingAction[] = [];
    const mentions = new Map<string, EntityRef>();
    let inputTokens = 0;
    let outputTokens = 0;
    let steps = 0;
    let text = "";
    let truncated = false;

    while (steps < maxSteps) {
        steps += 1;

        const response = await anthropic.messages.create({
            model,
            max_tokens: Number(env.anthropic_max_tokens) || 400,
            system: SYSTEM_PROMPT,
            tools: AGENT_TOOLS,
            messages
        });

        inputTokens += response.usage.input_tokens;
        outputTokens += response.usage.output_tokens;

        const said = textOf(response);
        if (said) text = said;

        // A tool call cut off mid-JSON never runs. Saying so beats the generic
        // "could not finish", which sent the user round the same loop again.
        if (response.stop_reason === "max_tokens") truncated = true;

        const toolUses = response.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

        messages.push({ role: "assistant", content: response.content });

        // Every result goes back in ONE user message — splitting them teaches
        // the model to stop calling tools in parallel.
        const results: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUses) {
            try {
                /**
                 * No authorisation is ever granted from inside the model loop.
                 * `confirm` is stripped as well: it is not in any schema any
                 * more, but a model that invents it must not be able to arm
                 * anything with it.
                 */
                const { confirm: _ignored, ...safeInput } =
                    (toolUse.input ?? {}) as Record<string, unknown>;

                const outcome = await executeTool(toolUse.name, safeInput, context);

                if (outcome.applied) {
                    actions.push(outcome.applied);
                    mentions.set(outcome.applied.id, outcome.applied);
                }

                outcome.appliedMany?.forEach((action) => {
                    actions.push(action);
                    mentions.set(action.id, action);
                });

                if (outcome.pending) pendings.push(outcome.pending);

                // Keyed by id, so listing the same collection twice adds nothing.
                outcome.seen?.forEach((entity) => mentions.set(entity.id, entity));

                results.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(outcome.result)
                });
            } catch (error: any) {
                // Hand the failure back as a result: the model can apologise or
                // try another way. Throwing here would lose the whole turn.
                results.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: JSON.stringify({ error: error?.message ?? "failed" }),
                    is_error: true
                });
            }
        }

        messages.push({ role: "user", content: results });
    }

    // A model that emits one call per target would produce a row of buttons;
    // merging them means the user authorises the batch once.
    const pending = mergePending(pendings);

    const rate = PRICING[model] ?? PRICING["claude-haiku-4-5"];

    const costUsd =
        (inputTokens / 1_000_000) * rate.input +
        (outputTokens / 1_000_000) * rate.output;

    return {
        text:
            (pending && !text ? `${pending.intent}?` : text) ||
            (actions.length
                ? "Done."
                : truncated
                    ? "That plan was too big to write in one go — ask for fewer modules, or set it up one module at a time."
                    : "I could not finish that — try naming the module or record."),
        actions,
        pending,
        mentions: Array.from(mentions.values()).slice(0, 60),
        usage: {
            inputTokens,
            outputTokens,
            costUsd: Number(costUsd.toFixed(6)),
            steps
        }
    };
}


/**
 * Run something the user just authorised.
 *
 * Deliberately does NOT go back to the model: the intent was already decided
 * last turn, so replaying it here is both free and deterministic — no chance of
 * the model re-reading the request and doing something else. The executor still
 * re-checks membership and module access, so this grants no authority the user
 * did not already have.
 */
export async function runAuthorised(
    pending: PendingAction,
    context: ToolContext
): Promise<AgentReply> {

    if (!isConfirmableTool(pending.tool)) {
        throw new Error("That action does not need authorising");
    }

    // The one place authorisation is granted, and only after a real press.
    const outcome = await executeTool(pending.tool, pending.input, context, {
        authorised: true
    });

    const failure = (outcome.result as { error?: string })?.error;

    const applied = outcome.applied
        ? [outcome.applied]
        : outcome.appliedMany ?? [];

    return {
        text: failure ?? `${pending.intent} — done.`,
        actions: applied,
        mentions: applied,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, steps: 0 }
    };
}
