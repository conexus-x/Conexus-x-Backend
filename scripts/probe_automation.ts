/**
 * End-to-end probe of the automation engine, against a throwaway fixture.
 *
 * Exercises the ENGINE and its emitters directly rather than over HTTP: the
 * interesting logic (subject guard, column-by-name resolution, the checklist
 * decision) lives there, and a probe that goes through the routes would mostly
 * be testing auth.
 *
 * Everything is created under one workspace and deleted at the end.
 */

import mongoose from "mongoose";
import env from "../config/env.js";

import Workspace from "../models/Workspace";
import WorkspaceMember from "../models/WorkspaceMember";
import Module from "../models/Module";
import Collection from "../models/Collection";
import Column from "../models/Column";
import RecordModel from "../models/Record";
import RecordValue from "../models/RecordValue";
import Comment from "../models/Comment";
import Activity from "../models/Activity";
import Automation from "../models/Automation";
import User from "../models/User";

import { runAutomations } from "../services/automation";
import {
    emitColumnChange,
    emitIfChecklistFinished
} from "../services/automation/emit";
import { systemUserId } from "../utils/systemUsers";

const oid = () => new mongoose.Types.ObjectId();

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
    if (condition) {
        pass++;
        console.log(`  PASS  ${name}`);
    } else {
        fail++;
        failures.push(name + (detail ? ` — ${detail}` : ""));
        console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

async function main() {
    await mongoose.connect((env as any).mongo_url, { serverSelectionTimeoutMS: 8000 });
    console.log("connected\n");

    const stamp = Date.now();
    const user = await User.create({
        firstName: "Probe",
        lastName: "Runner",
        email: `probe-${stamp}@example.test`,
        authProvider: "google",
        googleId: `probe-${stamp}`
    });

    const ws = await Workspace.create({
        name: `PROBE ${stamp}`,
        slug: `probe-${stamp}`,
        owner: user._id,
        createdBy: user._id
    });

    await WorkspaceMember.create({
        workspace: ws._id,
        user: user._id,
        role: "owner",
        status: "active"
    });

    // Two modules, so workspace scope and cross-module actions are real.
    const deals = await Module.create({
        workspace: ws._id, name: "Deals", createdBy: user._id
    });
    const projects = await Module.create({
        workspace: ws._id, name: "Projects", createdBy: user._id
    });

    const backlog = await Collection.create({
        module: deals._id, workspace: ws._id, name: "Backlog", position: 0, createdBy: user._id
    });
    const done = await Collection.create({
        module: deals._id, workspace: ws._id, name: "Done", position: 1, createdBy: user._id
    });
    const projBacklog = await Collection.create({
        module: projects._id, workspace: ws._id, name: "Intake", position: 0, createdBy: user._id
    });

    // Both modules get a column literally called "Status", which is what a
    // workspace recipe matches on.
    const dealStatus = await Column.create({
        module: deals._id, name: "Status", type: "status", scope: "record",
        position: 0, createdBy: user._id,
        statusOptions: [{ label: "Open", color: "#999" }, { label: "Won", color: "#0a0" }]
    });
    const dealFlag = await Column.create({
        module: deals._id, name: "Flag", type: "text", scope: "record", position: 1, createdBy: user._id
    });
    const projStatus = await Column.create({
        module: projects._id, name: "Status", type: "status", scope: "record",
        position: 0, createdBy: user._id,
        statusOptions: [{ label: "Open", color: "#999" }, { label: "Won", color: "#0a0" }]
    });
    // Sub-record column set — deliberately its own, same name as a record one
    // so a scope mix-up would be caught rather than silently work.
    const subStatus = await Column.create({
        module: deals._id, name: "Status", type: "status", scope: "subrecord",
        position: 0, createdBy: user._id,
        statusOptions: [{ label: "Todo", color: "#999" }, { label: "Blocked", color: "#a00" }]
    });

    const mkRecord = (name: string, collection = backlog, module = deals) =>
        RecordModel.create({
            workspace: ws._id, module: module._id, collectionName: collection._id,
            parentRecord: null, name, position: 0, createdBy: user._id
        });

    const mkSub = (parent: any, name: string) =>
        RecordModel.create({
            workspace: ws._id, module: parent.module, collectionName: parent.collectionName,
            parentRecord: parent._id, name, position: 0, createdBy: user._id
        });

    const mkAutomation = (body: any) =>
        Automation.create({
            workspace: ws._id,
            module: body.scope === "workspace" ? null : deals._id,
            scope: body.scope ?? "module",
            isActive: true,
            match: "all",
            conditions: [],
            createdBy: user._id,
            ...body
        });

    const cellOf = async (record: any, column: any) =>
        (await RecordValue.findOne({ record: record._id, column: column._id }).lean())?.value ?? null;

    try {
        /* ---------------------------------------------------------- *
         * 1. The original behaviour still works
         * ---------------------------------------------------------- */
        console.log("1. column_changed_to -> move_to_collection");
        {
            const a = await mkAutomation({
                name: "Won moves to Done",
                trigger: { type: "column_changed_to", column: dealStatus._id, value: "Won" },
                actions: [{ type: "move_to_collection", collectionName: done._id }]
            });
            const rec = await mkRecord("Acme deal");

            await runAutomations({
                type: "column_changed_to", workspace: ws._id, module: deals._id,
                record: rec._id, column: dealStatus._id, user: user._id,
                before: "Open", after: "Won"
            });

            const after = await RecordModel.findById(rec._id).lean();
            check("record moved to Done", String(after?.collectionName) === String(done._id));

            // Same event twice must not "move" it again.
            const runsBefore = (await Automation.findById(a._id).lean())?.runCount;
            await runAutomations({
                type: "column_changed_to", workspace: ws._id, module: deals._id,
                record: rec._id, column: dealStatus._id, user: user._id,
                before: "Open", after: "Won"
            });
            const runsAfter = (await Automation.findById(a._id).lean())?.runCount;
            check("re-firing counts a run but changes nothing", (runsAfter ?? 0) > (runsBefore ?? 0));

            await Automation.deleteOne({ _id: a._id });
        }

        /* ---------------------------------------------------------- *
         * 2. Subject guard — a record recipe must ignore a sub-record
         * ---------------------------------------------------------- */
        console.log("\n2. subject guard");
        {
            const a = await mkAutomation({
                name: "Record recipe",
                trigger: { type: "column_changed_to", column: dealStatus._id, value: "Won" },
                actions: [{ type: "set_completed", value: "true" }]
            });

            const parent = await mkRecord("Parent");
            const sub = await mkSub(parent, "Checklist line");

            // A sub-record cell write, emitted the way the controller does.
            await emitColumnChange({
                workspace: ws._id, module: deals._id, record: sub._id,
                column: subStatus._id, user: user._id, before: "Todo", after: "Won"
            });

            const subAfter = await RecordModel.findById(sub._id).lean();
            const parentAfter = await RecordModel.findById(parent._id).lean();
            check("sub-record NOT completed by a record recipe", subAfter?.isCompleted !== true);
            check("parent NOT completed by a record recipe", parentAfter?.isCompleted !== true);

            await Automation.deleteOne({ _id: a._id });
        }

        /* ---------------------------------------------------------- *
         * 3. Sub-record trigger rolls a result up to the parent
         * ---------------------------------------------------------- */
        console.log("\n3. subrecord_column_changed_to -> set_parent_column_value");
        {
            const a = await mkAutomation({
                name: "Blocked line flags the record",
                trigger: { type: "subrecord_column_changed_to", column: subStatus._id, value: "Blocked" },
                actions: [{ type: "set_parent_column_value", column: dealFlag._id, value: "Blocked: {record}" }]
            });

            const parent = await mkRecord("Rollup parent");
            const sub = await mkSub(parent, "Line one");

            await emitColumnChange({
                workspace: ws._id, module: deals._id, record: sub._id,
                column: subStatus._id, user: user._id, before: "Todo", after: "Blocked"
            });

            check(
                "parent's Flag written from the sub-record trigger",
                (await cellOf(parent, dealFlag)) === "Blocked: Line one",
                String(await cellOf(parent, dealFlag))
            );
            check("template {record} resolved to the SUB-record's name",
                String(await cellOf(parent, dealFlag)).includes("Line one"));

            await Automation.deleteOne({ _id: a._id });
        }

        /* ---------------------------------------------------------- *
         * 4. The checklist decision
         * ---------------------------------------------------------- */
        console.log("\n4. all_subrecords_completed");
        {
            const a = await mkAutomation({
                name: "Checklist closes the record",
                trigger: { type: "all_subrecords_completed" },
                actions: [{ type: "set_completed", value: "true" }]
            });

            // (a) a record with NO sub-records must never fire
            const lonely = await mkRecord("No children");
            await emitIfChecklistFinished({
                parentRecordId: lonely._id, workspace: ws._id, module: deals._id, user: user._id
            });
            check("no sub-records => does NOT fire",
                (await RecordModel.findById(lonely._id).lean())?.isCompleted !== true);

            // (b) one still outstanding must not fire
            const parent = await mkRecord("Two lines");
            const s1 = await mkSub(parent, "one");
            const s2 = await mkSub(parent, "two");

            await RecordModel.updateOne({ _id: s1._id }, { isCompleted: true });
            await emitIfChecklistFinished({
                parentRecordId: parent._id, workspace: ws._id, module: deals._id, user: user._id
            });
            check("one line outstanding => does NOT fire",
                (await RecordModel.findById(parent._id).lean())?.isCompleted !== true);

            // (c) the last one finishes it
            await RecordModel.updateOne({ _id: s2._id }, { isCompleted: true });
            await emitIfChecklistFinished({
                parentRecordId: parent._id, workspace: ws._id, module: deals._id, user: user._id
            });
            check("last line completed => record marked complete",
                (await RecordModel.findById(parent._id).lean())?.isCompleted === true);

            await Automation.deleteOne({ _id: a._id });
        }

        /* ---------------------------------------------------------- *
         * 5. record_created -> create_subrecord (and seeds sub columns)
         * ---------------------------------------------------------- */
        console.log("\n5. record_created -> create_subrecord");
        {
            const a = await mkAutomation({
                name: "New deals get a checklist",
                trigger: { type: "record_created" },
                actions: [{ type: "create_subrecord", value: "Qualify {record}" }]
            });

            const rec = await mkRecord("Globex");
            await runAutomations({
                type: "record_created", workspace: ws._id, module: deals._id,
                record: rec._id, collectionName: backlog._id, user: user._id
            });

            const kids = await RecordModel.find({ parentRecord: rec._id }).lean();
            check("sub-record created", kids.length === 1, `got ${kids.length}`);
            check("its name used the {record} template",
                kids[0]?.name === "Qualify Globex", String(kids[0]?.name));

            await Automation.deleteOne({ _id: a._id });
        }

        /* ---------------------------------------------------------- *
         * 6. Workspace scope resolves columns by NAME, on any module
         * ---------------------------------------------------------- */
        console.log("\n6. workspace scope, column by name");
        {
            const a = await mkAutomation({
                scope: "workspace",
                name: "Anything Won is complete",
                trigger: { type: "column_changed_to", columnName: "Status", value: "Won" },
                actions: [{ type: "set_completed", value: "true" }]
            });
            check("stored with module null", (await Automation.findById(a._id).lean())?.module == null);

            // Module A
            const dealRec = await mkRecord("WS deal");
            await runAutomations({
                type: "column_changed_to", workspace: ws._id, module: deals._id,
                record: dealRec._id, column: dealStatus._id, user: user._id,
                before: "Open", after: "Won"
            });
            check("fires on module A",
                (await RecordModel.findById(dealRec._id).lean())?.isCompleted === true);

            // Module B — the same recipe, a different module's Status column
            const projRec = await mkRecord("WS project", projBacklog, projects);
            await runAutomations({
                type: "column_changed_to", workspace: ws._id, module: projects._id,
                record: projRec._id, column: projStatus._id, user: user._id,
                before: "Open", after: "Won"
            });
            check("fires on module B with the SAME recipe",
                (await RecordModel.findById(projRec._id).lean())?.isCompleted === true);

            // A column of a different name on the same module must not match.
            const other = await mkRecord("WS other");
            await runAutomations({
                type: "column_changed_to", workspace: ws._id, module: deals._id,
                record: other._id, column: dealFlag._id, user: user._id,
                before: "", after: "Won"
            });
            check("a differently-named column does NOT match",
                (await RecordModel.findById(other._id).lean())?.isCompleted !== true);

            await Automation.deleteOne({ _id: a._id });
        }

        /* ---------------------------------------------------------- *
         * 7. Conditions: record fields, all vs any
         * ---------------------------------------------------------- */
        console.log("\n7. conditions");
        {
            // (a) record-field condition on collection
            const a = await mkAutomation({
                name: "Only in Backlog",
                trigger: { type: "record_renamed" },
                conditions: [{ source: "record", field: "collection", op: "is", value: String(backlog._id) }],
                actions: [{ type: "set_completed", value: "true" }]
            });

            const inBacklog = await mkRecord("in backlog");
            const inDone = await mkRecord("in done", done);

            await runAutomations({
                type: "record_renamed", workspace: ws._id, module: deals._id,
                record: inBacklog._id, user: user._id, before: "x", after: "in backlog"
            });
            await runAutomations({
                type: "record_renamed", workspace: ws._id, module: deals._id,
                record: inDone._id, user: user._id, before: "x", after: "in done"
            });

            check("collection condition holds",
                (await RecordModel.findById(inBacklog._id).lean())?.isCompleted === true);
            check("collection condition excludes the other collection",
                (await RecordModel.findById(inDone._id).lean())?.isCompleted !== true);
            await Automation.deleteOne({ _id: a._id });

            // (b) match "any"
            const b = await mkAutomation({
                name: "Any of these",
                trigger: { type: "record_renamed" },
                match: "any",
                conditions: [
                    { source: "record", field: "collection", op: "is", value: String(oid()) },
                    { source: "record", field: "name", op: "contains", value: "widget" }
                ],
                actions: [{ type: "set_completed", value: "true" }]
            });

            const anyHit = await mkRecord("blue widget");
            await runAutomations({
                type: "record_renamed", workspace: ws._id, module: deals._id,
                record: anyHit._id, user: user._id, before: "x", after: "blue widget"
            });
            check("match=any fires when only the second holds",
                (await RecordModel.findById(anyHit._id).lean())?.isCompleted === true);

            // (c) the same two conditions with match "all" must NOT fire
            await Automation.updateOne({ _id: b._id }, { match: "all" });
            const allMiss = await mkRecord("red widget");
            await runAutomations({
                type: "record_renamed", workspace: ws._id, module: deals._id,
                record: allMiss._id, user: user._id, before: "x", after: "red widget"
            });
            check("match=all does NOT fire when one fails",
                (await RecordModel.findById(allMiss._id).lean())?.isCompleted !== true);

            await Automation.deleteOne({ _id: b._id });

            // (d) sub-record count condition
            const c = await mkAutomation({
                name: "Only childless",
                trigger: { type: "record_renamed" },
                conditions: [{ source: "record", field: "subrecord_count", op: "is", value: "0" }],
                actions: [{ type: "set_completed", value: "true" }]
            });
            const childless = await mkRecord("childless");
            const withKid = await mkRecord("has a kid");
            await mkSub(withKid, "kid");

            for (const r of [childless, withKid]) {
                await runAutomations({
                    type: "record_renamed", workspace: ws._id, module: deals._id,
                    record: r._id, user: user._id, before: "x", after: r.name
                });
            }
            check("subrecord_count=0 holds for a childless record",
                (await RecordModel.findById(childless._id).lean())?.isCompleted === true);
            check("subrecord_count=0 excludes one with a child",
                (await RecordModel.findById(withKid._id).lean())?.isCompleted !== true);

            await Automation.deleteOne({ _id: c._id });
        }

        /* ---------------------------------------------------------- *
         * 8. Cross-module create_record + the workspace gate
         * ---------------------------------------------------------- */
        console.log("\n8. create_record across modules");
        {
            const a = await mkAutomation({
                name: "Won deal opens a project",
                trigger: { type: "record_completed" },
                actions: [{
                    type: "create_record",
                    targetModule: projects._id,
                    targetCollection: projBacklog._id,
                    value: "Deliver {record}"
                }]
            });

            const rec = await mkRecord("Initech");
            await runAutomations({
                type: "record_completed", workspace: ws._id, module: deals._id,
                record: rec._id, user: user._id, before: "false", after: "true"
            });

            const made = await RecordModel.findOne({
                collectionName: projBacklog._id, name: "Deliver Initech"
            }).lean();
            check("record created on the OTHER module", Boolean(made));
            check("it landed on the target module",
                String(made?.module) === String(projects._id));

            await Automation.deleteOne({ _id: a._id });

            // The workspace gate: a collection outside this workspace is refused.
            const foreignWs = await Workspace.create({
                name: `PROBE-FOREIGN ${stamp}`, slug: `probe-foreign-${stamp}`,
                owner: user._id, createdBy: user._id
            });
            const foreignMod = await Module.create({
                workspace: foreignWs._id, name: "Foreign", createdBy: user._id
            });
            const foreignCol = await Collection.create({
                module: foreignMod._id, workspace: foreignWs._id, name: "Nope",
                position: 0, createdBy: user._id
            });

            const b = await mkAutomation({
                name: "Tries to escape",
                trigger: { type: "record_completed" },
                actions: [{
                    type: "create_record",
                    targetModule: foreignMod._id,
                    targetCollection: foreignCol._id,
                    value: "Should not exist"
                }]
            });

            const rec2 = await mkRecord("Escaper");
            await runAutomations({
                type: "record_completed", workspace: ws._id, module: deals._id,
                record: rec2._id, user: user._id, before: "false", after: "true"
            });

            const escaped = await RecordModel.findOne({ name: "Should not exist" }).lean();
            check("cannot create into another WORKSPACE", !escaped);

            await Automation.deleteOne({ _id: b._id });
            await Collection.deleteMany({ module: foreignMod._id });
            await Module.deleteMany({ workspace: foreignWs._id });
            await Workspace.deleteOne({ _id: foreignWs._id });
        }

        /* ---------------------------------------------------------- *
         * 9. amendment_posted -> post_amendment + rename
         * ---------------------------------------------------------- */
        console.log("\n9. amendments and renaming");
        {
            const a = await mkAutomation({
                name: "Flag discussed records",
                trigger: { type: "amendment_posted" },
                actions: [{ type: "set_column_value", column: dealFlag._id, value: "Discussed" }]
            });

            const rec = await mkRecord("Talked about");
            await runAutomations({
                type: "amendment_posted", workspace: ws._id, module: deals._id,
                record: rec._id, user: user._id, after: "hello", text: "hello"
            });
            check("amendment_posted set a column", (await cellOf(rec, dealFlag)) === "Discussed");
            await Automation.deleteOne({ _id: a._id });

            const b = await mkAutomation({
                name: "Announce and rename",
                trigger: { type: "record_archived" },
                actions: [
                    { type: "post_amendment", value: "Archived automatically ({value})" },
                    { type: "rename_record", value: "{record} [archived]" }
                ]
            });

            const rec2 = await mkRecord("Old deal");
            await runAutomations({
                type: "record_archived", workspace: ws._id, module: deals._id,
                record: rec2._id, user: user._id, before: "Old deal", after: "gone"
            });

            const posted = await Comment.findOne({ record: rec2._id }).lean();
            check("amendment posted by the engine", Boolean(posted));
            check("its {value} resolved", String(posted?.message).includes("gone"),
                String(posted?.message));
            check("record renamed with {record}",
                (await RecordModel.findById(rec2._id).lean())?.name === "Old deal [archived]");

            await Automation.deleteOne({ _id: b._id });
        }

        /* ---------------------------------------------------------- *
         * 10. Runs are attributed and discoverable
         * ---------------------------------------------------------- */
        console.log("\n10. run feed");
        {
            const rows = await Activity.find({
                workspace: ws._id,
                "metadata.automation": { $exists: true }
            }).lean();

            check("automated changes wrote activity rows", rows.length > 0, `${rows.length} rows`);
            // Attribution moved to the Automation bot 2026-08-26; the person
            // who caused it is asserted on metadata.triggeredBy in section 11.
            check("none still attributed to the triggering person as the actor",
                rows.every((r: any) => String(r.user) !== String(user._id)));
            check("all name their recipe in the message",
                rows.every((r: any) => String(r.message).startsWith('automation "')));
        }

        /* ---------------------------------------------------------- *
         * 11. The Automation bot is the actor
         * ---------------------------------------------------------- */
        console.log("");
        console.log("11. system bot attribution");
        {
            const bot = await User.findOne({ systemKey: "automation" }).lean();

            check("the Automation bot was created on first use", Boolean(bot));
            check("it cannot sign in (isActive false)", bot?.isActive === false);
            check("it has no password", !bot?.password);

            const rows = await Activity.find({
                workspace: ws._id,
                "metadata.automation": { $exists: true }
            }).lean();

            check(
                "automated rows are acted by the BOT, not the triggering person",
                rows.every((r: any) => String(r.user) === String(bot?._id)),
                `${rows.filter((r: any) => String(r.user) !== String(bot?._id)).length} rows attributed elsewhere`
            );

            check(
                "the triggering person is preserved on metadata.triggeredBy",
                rows.every((r: any) => String(r.metadata?.triggeredBy) === String(user._id))
            );

            check(
                "the recipe name is stamped so a deleted recipe still names itself",
                rows.every((r: any) => Boolean(r.metadata?.automationName))
            );

            // Asking twice must not make a second bot.
            const again = await systemUserId("automation");
            check("get-or-create is idempotent",
                String(again) === String(bot?._id));
            check("exactly one bot row exists",
                (await User.countDocuments({ systemKey: "automation" })) === 1);
        }

        /* ---------------------------------------------------------- *
         * 12. Inactive recipes never run
         * ---------------------------------------------------------- */
        console.log("\n11. paused recipes");
        {
            const a = await mkAutomation({
                name: "Paused",
                isActive: false,
                trigger: { type: "record_renamed" },
                actions: [{ type: "set_completed", value: "true" }]
            });
            const rec = await mkRecord("untouched");
            await runAutomations({
                type: "record_renamed", workspace: ws._id, module: deals._id,
                record: rec._id, user: user._id, before: "x", after: "untouched"
            });
            check("a paused recipe does nothing",
                (await RecordModel.findById(rec._id).lean())?.isCompleted !== true);
            await Automation.deleteOne({ _id: a._id });
        }

    } finally {
        /* Clean up everything this probe made. */
        const modules = await Module.find({ workspace: ws._id }).select("_id").lean();
        const moduleIds = modules.map((m) => m._id);

        await RecordValue.deleteMany({ workspace: ws._id });
        await Comment.deleteMany({ workspace: ws._id });
        await RecordModel.deleteMany({ workspace: ws._id });
        await Column.deleteMany({ module: { $in: moduleIds } });
        await Collection.deleteMany({ module: { $in: moduleIds } });
        await Module.deleteMany({ workspace: ws._id });
        await Automation.deleteMany({ workspace: ws._id });
        await Activity.deleteMany({ workspace: ws._id });
        await WorkspaceMember.deleteMany({ workspace: ws._id });
        await Workspace.deleteOne({ _id: ws._id });
        await User.deleteOne({ _id: user._id });
        // The Automation bot is deliberately NOT deleted — it is process-wide
        // infrastructure shared with real data, not part of this fixture.

        console.log(`\n${"=".repeat(50)}`);
        console.log(`PASS ${pass}   FAIL ${fail}`);
        if (failures.length) {
            console.log("\nFailures:");
            failures.forEach((f) => console.log("  - " + f));
        }
        console.log("cleaned up");
        await mongoose.disconnect();
        process.exit(fail === 0 ? 0 : 1);
    }
}

main().catch(async (e) => {
    console.error("PROBE CRASHED:", e);
    await mongoose.disconnect();
    process.exit(1);
});
