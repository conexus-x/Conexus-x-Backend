# skills
Layering: routes -> controllers -> models. Reusable logic to services/ or utils/. No DB calls in routes.
New endpoint: add controller fn, mount in routes/*.routes.ts, register in app.ts if new resource.
Auth: every non-auth route takes `protect`. Read owner from req.user.id (AuthRequest), never from body/query.
Scoping: filter every query by workspace membership; never trust client-supplied workspace/user ids.
Mutations: call touchWorkspace(workspaceId) after create/update/delete.
Responses: res.status(code).json({ message | data }). 401 auth, 403 permission, 404 missing, 400 validation.
Errors: try/catch per controller, log server-side, return generic message. Never leak stack/driver errors.
Secrets: process.env only, never logged or returned. Passwords via utils/hash.ts, never selected back.
Models: define TS interface + schema together, ObjectId refs with `ref`, keep timestamps:true.
NEVER duplicate a store to serve a second view. If rows already exist in a collection, add a FILTER + a label to the endpoint that reads them, not a parallel endpoint. Automation runs are Activity rows stamped metadata.automation and are read via GET /api/activity?source=automation — the old /automations/:moduleId/runs was deleted precisely because it was a second read path over identical rows. Same rule for any future "X feed".
Enums are the contract: a client mirror exists for most of them (app/lib/*, app/store/api/*) — change both together or the server starts rejecting what the UI offers.
Validate where the engine reads: sanitise+validate belong in a service both the controller and the consumer import (services/automation/recipe.ts), never inline in a controller, or the two disagree about what is valid.
Registry over switch: dispatch by lookup table (services/automation/actions) so an unknown type is skipped, not thrown, and old rows survive a renamed case.
Derived reads need their own tag/filter, never a widened one — see the memory note on RecordValue LIST.
TS: strict, no `any` in new code except RecordValue.value.
Verify: npx tsc --noEmit; npm run dev must boot and log Mongo connect.
Probe, do not eyeball: anything whose read path and write path were authored separately gets a throwaway-fixture script under scripts/ that asserts and cleans up after itself (scripts/probe_automation.ts, 32 assertions — re-run after touching the engine). Two rules written in different sittings can each look right and cancel out; only running them together shows it.
Schema: request -> minimal diff -> tsc --noEmit -> report file:line.
