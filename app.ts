import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import { apiCacheHeaders } from "./middleware/cache.middleware";

import authRoutes from "./routes/auth.routes";
import workspaceRoutes from "./routes/workspace.routes";
import workspaceMemberRoutes from "./routes/workspaceMember.routes";
import moduleAccessRoutes from "./routes/moduleAccess.routes";
import agentRoutes from "./routes/agent.routes";
import moduleRoutes from "./routes/module.routes";
import collectionRoutes from "./routes/collection.routes";
import columnRoutes from "./routes/column.routes";
import recordRoutes from "./routes/record.routes";
import recordValueRoutes from "./routes/recordValue.routes";
import apiKeyRoutes from "./routes/apiKey.routes";
import uploadRoutes from "./routes/upload.routes";
import activityRoutes from "./routes/activity.routes";
import automationRoutes from "./routes/automation.routes";
import amendmentRoutes from "./routes/amendment.routes";
import conversationRoutes from "./routes/conversation.routes";
import messageRoutes from "./routes/message.routes";

const app = express();

// Weak ETags on JSON responses let clients revalidate with a 304 (Express default,
// stated explicitly so it cannot be turned off by accident).
app.set("etag", "weak");

app.use(cors());

app.use(express.json());

app.use("/api", apiCacheHeaders);


/**
 * Liveness check.
 *
 * Lives on the app rather than in routes/ + controllers/ because it is not a
 * resource — it describes THIS PROCESS, and a health endpoint that has to be
 * looked up through two other files is one nobody finds when the server is the
 * thing being debugged.
 *
 * IT REPORTS MONGO, and returns 503 when the connection is down. An endpoint
 * that answers 200 while every query behind it fails is worse than none: it is
 * exactly the reading a load balancer or an uptime monitor trusts to decide the
 * service is healthy. "Running" and "able to serve a request" are different
 * claims and this makes the second one.
 *
 * Deliberately no env values, versions or paths in the body — this is the one
 * route with no `protect` on it, so it must be safe for anyone to read.
 */
const DB_STATES: Record<number, string> = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
};

app.get("/", (_req, res) => {
    const state = mongoose.connection.readyState;
    const database = DB_STATES[state] ?? "unknown";
    const healthy = state === 1;

    // Never cached: a stale "ok" is the one answer this route must not give.
    res.set("Cache-Control", "no-store");

    res.status(healthy ? 200 : 503).json({
        status: healthy ? "ok" : "degraded",
        service: "Conexus X API",
        database,
        uptimeSeconds: Math.floor(process.uptime()),
        time: new Date().toISOString(),
    });
});


// Routes
app.use("/api/auth", authRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/workspace-members", workspaceMemberRoutes);
app.use("/api/module-access", moduleAccessRoutes);
app.use("/api/agent", agentRoutes);
app.use("/api/modules", moduleRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/columns", columnRoutes);
app.use("/api/records", recordRoutes);
app.use("/api/record-values", recordValueRoutes);
app.use("/api/api-key", apiKeyRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/automations", automationRoutes);
app.use("/api/amendments", amendmentRoutes);

// Conexus Meet
app.use("/api/conversations", conversationRoutes);
app.use("/api/messages", messageRoutes);


export default app;