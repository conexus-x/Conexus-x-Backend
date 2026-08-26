import Automation from "../../models/Automation";
import RecordModel from "../../models/Record";
import { ColumnResolver } from "./columns";
import { conditionsHold, loadCells } from "./conditions";
import { columnScopeOf, subjectOf, triggerMatches } from "./triggers";
import { runActions } from "./actions";
import type { AutomationEvent } from "./types";

/**
 * The automation engine.
 *
 * Controllers emit an event after a successful write; this decides which
 * recipes match, checks their conditions, and runs their actions.
 *
 * Four rules hold the whole thing together:
 *
 *  1. **Never fail the caller.** A broken recipe must not turn a user's edit
 *     into a 500. Errors are captured onto the automation row instead.
 *  2. **No cascades.** Actions write through the models directly and never
 *     re-enter the engine, so an automation cannot trigger another automation
 *     (or itself) and loop forever. This is why the action handlers use
 *     RecordModel rather than calling the record controller.
 *  3. **Attribution is preserved.** Activity rows for automated changes are
 *     logged against the user whose edit set them off, with the automation
 *     named in the message, so the audit trail stays truthful.
 *  4. **Subject discipline.** A record trigger never fires on a sub-record and
 *     a sub-record trigger never fires on a record. See subjectOf().
 */

export type { AutomationEvent };

export async function runAutomations(event: AutomationEvent): Promise<void> {
    try {
        /**
         * Both halves of the scope in one query: recipes pinned to this module,
         * and workspace recipes that watch every module in it. Indexed by
         * (module, isActive, trigger.type) and (workspace, scope, isActive,
         * trigger.type) respectively.
         */
        const candidates = await Automation.find({
            isActive: true,
            "trigger.type": event.type,
            $or: [
                { module: event.module },
                { scope: "workspace", workspace: event.workspace }
            ]
        });

        if (candidates.length === 0) return;

        // Shared across every recipe in this event: a workspace recipe naming
        // "Status" resolves it once for this module, not once per recipe.
        const columns = new ColumnResolver();

        const matched: typeof candidates = [];
        for (const automation of candidates) {
            if (await triggerMatches(automation, event, columns)) matched.push(automation);
        }
        if (matched.length === 0) return;

        /**
         * The subject guard. Every candidate shares the event's trigger type,
         * so which kind of row this trigger is about is decided once.
         *
         * Checked only after a rule would actually have run, so the hot path —
         * a cell write on a module with no matching recipe — pays nothing for
         * it.
         */
        const record = await RecordModel.findById(event.record);
        if (!record) return;

        const wantsSubRecord = subjectOf(event.type) === "subrecord";
        if (wantsSubRecord !== Boolean(record.parentRecord)) return;

        // One read of the record's cells, shared by every recipe's conditions.
        const cells = await loadCells(event.record);
        const columnScope = columnScopeOf(event.type);

        for (const automation of matched) {
            try {
                const holds = await conditionsHold(
                    automation,
                    event,
                    record,
                    cells,
                    columns,
                    columnScope
                );
                if (!holds) continue;

                const applied = await runActions(automation, event, record, columns);

                await Automation.findByIdAndUpdate(automation._id, {
                    $inc: { runCount: 1 },
                    lastRunAt: new Date(),
                    lastError: ""
                });

                if (applied > 0) {
                    console.log(
                        `Automation "${automation.name}" ran (${applied} action${applied === 1 ? "" : "s"})`
                    );
                }
            } catch (error) {
                const message = (error as Error).message;
                console.error(`Automation "${automation.name}" failed:`, message);

                // Surfaced on the card so a broken recipe is visible, not silent.
                await Automation.findByIdAndUpdate(automation._id, {
                    lastRunAt: new Date(),
                    lastError: message.slice(0, 300)
                });
            }
        }
    } catch (error) {
        // The engine itself failing must never break the user's write.
        console.error("Automation engine error:", (error as Error).message);
    }
}
