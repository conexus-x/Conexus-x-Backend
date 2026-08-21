import express from "express";
import cors from "cors";

import { apiCacheHeaders } from "./middleware/cache.middleware";

import authRoutes from "./routes/auth.routes";
import workspaceRoutes from "./routes/workspace.routes";
import workspaceMemberRoutes from "./routes/workspaceMember.routes";
import moduleRoutes from "./routes/module.routes";
import collectionRoutes from "./routes/collection.routes";
import columnRoutes from "./routes/column.routes";
import recordRoutes from "./routes/record.routes";
import recordValueRoutes from "./routes/recordValue.routes";
import apiKeyRoutes from "./routes/apiKey.routes";
import uploadRoutes from "./routes/upload.routes";

const app = express();

// Weak ETags on JSON responses let clients revalidate with a 304 (Express default,
// stated explicitly so it cannot be turned off by accident).
app.set("etag", "weak");

app.use(cors());

app.use(express.json());

app.use("/api", apiCacheHeaders);


// Routes
app.use("/api/auth", authRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/workspace-members", workspaceMemberRoutes);
app.use("/api/modules", moduleRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/columns", columnRoutes);
app.use("/api/records", recordRoutes);
app.use("/api/record-values", recordValueRoutes);
app.use("/api/api-key", apiKeyRoutes);
app.use("/api/uploads", uploadRoutes);


export default app;