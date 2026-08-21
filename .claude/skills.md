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
TS: strict, no `any` in new code except RecordValue.value.
Verify: npx tsc --noEmit; npm run dev must boot and log Mongo connect.
Schema: request -> minimal diff -> tsc --noEmit -> report file:line.
