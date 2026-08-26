import { logActivity } from "../../activity.service";
import { systemUserId } from "../../../utils/systemUsers";
import { fillTemplate } from "../values";
import { columnScopeOf } from "../triggers";
import type { ColumnResolver } from "../columns";
import { recordActions } from "./record.actions";
import { subRecordActions } from "./subrecord.actions";
import { parentActions } from "./parent.actions";
import { createActions } from "./create.actions";
import type {
    ActionContext,
    ActionHandler,
    AutomationEvent,
    IAutomation
} from "../types";
import type { IRecord } from "../../../models/Record";

/**
 * The whole action vocabulary, in one lookup.
 *
 * Adding an action is: a name in ACTION_TYPES, a handler in one of the four
 * files above, and an entry here. Nothing in the engine switches on action
 * type any more — an unknown type simply has no handler and is skipped, which
 * is what makes an old recipe survive a renamed action instead of throwing.
 */
export const HANDLERS: Record<string, ActionHandler> = {
    ...recordActions,
    ...subRecordActions,
    ...parentActions,
    ...createActions
};

export async function runActions(
    automation: IAutomation,
    event: AutomationEvent,
    record: IRecord,
    columns: ColumnResolver
): Promise<number> {
    let applied = 0;

    const defaultScope = columnScopeOf(event.type);

    for (const action of automation.actions ?? []) {
        const handler = HANDLERS[action.type];
        if (!handler) continue;

        const ctx: ActionContext = {
            automation,
            event,
            action,
            record,

            column: (moduleId, scope) =>
                columns.resolve(action, moduleId, scope ?? defaultScope),

            fill: (template) =>
                fillTemplate(template, { record: record.name, value: event.after }),

            /**
             * The ACTOR is the Automation bot, not the person whose edit set
             * this off — a rule moving five records should not read as though a
             * colleague did it by hand. Who triggered it is kept on
             * metadata.triggeredBy, so the trail still answers "why did this
             * happen now?"; it is simply no longer the headline.
             *
             * If the bot cannot be resolved we fall back to the triggering
             * user, which is exactly the old behaviour — a missing bot must
             * never cost us the audit row itself.
             *
             * metadata.automation is what the activity feed reads to label a
             * row, and the name prefix is what it strips back off. Both live
             * here so no handler can forget either.
             */
            log: async (entry) => {
                const actor = (await systemUserId("automation")) ?? event.user;

                await logActivity({
                    workspace: event.workspace,
                    user: actor,
                    action: entry.action,
                    module: entry.module ?? event.module,
                    collectionName: entry.collectionName,
                    record: entry.record ?? event.record,
                    column: entry.column,
                    targetName: entry.targetName ?? "",
                    before: entry.before,
                    after: entry.after,
                    message: `automation "${automation.name}" ${entry.message}`,
                    metadata: {
                        automation: String(automation._id),
                        /**
                         * The name is STAMPED here, not looked up on read.
                         * A recipe can be deleted while its rows survive — the
                         * audit trail outlives the rule — and a feed that then
                         * says "a deleted automation" has lost the one fact
                         * that made the row explicable. Stamping also spares
                         * the feed a query per page.
                         */
                        automationName: automation.name,
                        triggeredBy: String(event.user)
                    }
                });
            }
        };

        if (await handler(ctx)) applied++;
    }

    return applied;
}
