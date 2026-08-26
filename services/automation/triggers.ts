import type { TriggerType } from "../../models/Automation";
import type { ColumnResolver } from "./columns";
import { same } from "./values";
import type { AutomationEvent, IAutomation } from "./types";

/**
 * What kind of row a trigger is about.
 *
 * This is the guard that keeps board recipes off checklist lines. "When Status
 * becomes Done, move the record to Done" must not fire on a sub-record and move
 * its PARENT's collection — which is what a single shared subject would do.
 * The engine drops any event whose subject does not match its trigger's.
 *
 * amendment_posted is deliberately record-only: a sub-record can carry
 * amendments, but a recipe reading "when someone comments, flag the record"
 * means the row on the board, and firing it from a checklist line would flag
 * something the commenter was not looking at.
 */
export function subjectOf(type: TriggerType): "record" | "subrecord" {
    switch (type) {
        case "subrecord_created":
        case "subrecord_column_changed":
        case "subrecord_column_changed_to":
        case "subrecord_completed":
            return "subrecord";
        default:
            return "record";
    }
}

/** Which column set a trigger's column lives in. */
export function columnScopeOf(type: TriggerType): "record" | "subrecord" {
    return subjectOf(type) === "subrecord" ? "subrecord" : "record";
}

/** Does this recipe's trigger match the event that just happened? */
export async function triggerMatches(
    automation: IAutomation,
    event: AutomationEvent,
    columns: ColumnResolver
): Promise<boolean> {
    if (automation.trigger.type !== event.type) return false;

    switch (event.type) {
        case "column_changed":
        case "subrecord_column_changed": {
            const watched = await columns.resolve(
                automation.trigger,
                event.module,
                columnScopeOf(event.type)
            );
            return Boolean(watched) && same(watched, event.column);
        }

        case "column_changed_to":
        case "subrecord_column_changed_to": {
            const watched = await columns.resolve(
                automation.trigger,
                event.module,
                columnScopeOf(event.type)
            );

            return (
                Boolean(watched) &&
                same(watched, event.column) &&
                same(automation.trigger.value, event.after) &&
                // Only on the transition INTO the value, not on every re-save.
                !same(event.before, event.after)
            );
        }

        /**
         * The rest carry no discriminator of their own. "Moved to a particular
         * collection" and "renamed to something specific" are expressible as
         * conditions on the record's own fields, which is where they belong —
         * a second filter on the trigger would be a third way to say the same
         * thing.
         */
        default:
            return true;
    }
}
