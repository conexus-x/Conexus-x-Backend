/**
 * Value handling shared by triggers, conditions and actions.
 *
 * Cells are stored as strings (see the encodings note in the frontend memory),
 * so every comparison here is a string comparison unless it can safely be read
 * as a number. That is deliberate: a recipe written against "Done" must match
 * the "Done" a status picker wrote, whatever the column's type says.
 */

export const str = (value: unknown): string =>
    value === null || value === undefined ? "" : String(value);

/** Case-insensitive so "Done" from a picker matches "done" typed into a rule. */
export const same = (a: unknown, b: unknown): boolean =>
    str(a).trim().toLowerCase() === str(b).trim().toLowerCase();

export const asNumber = (value: unknown): number | null => {
    const n = parseFloat(str(value));
    return isNaN(n) ? null : n;
};

/**
 * The two placeholders an action's text may carry.
 *
 * Kept to exactly these: anything richer (a second column's value, a date
 * offset) needs a resolver with its own failure modes, and a placeholder that
 * silently renders empty is worse than one that was never offered.
 *
 *   {record}  the name of the record the trigger fired on
 *   {value}   the value that fired it, for the column triggers
 */
export function fillTemplate(
    template: string | undefined,
    vars: { record?: string; value?: unknown }
): string {
    return str(template)
        .replace(/\{record\}/gi, str(vars.record))
        .replace(/\{value\}/gi, str(vars.value));
}
