/**
 * The engine moved into services/automation/ when it grew past one screen —
 * triggers, conditions, column addressing and four families of action are now
 * each their own file.
 *
 * This shim stays so every existing `from "../services/automation.service"`
 * import keeps resolving. New code should import from "../services/automation"
 * directly.
 */
export { runAutomations, type AutomationEvent } from "./automation/index";
export { emitIfChecklistFinished } from "./automation/emit";
