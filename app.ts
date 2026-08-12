import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.routes";
import workspaceRoutes from "./routes/workspace.routes";
import workspaceMemberRoutes from "./routes/workspaceMember.routes";
import moduleRoutes from "./routes/module.routes";
import collectionRoutes from "./routes/collection.routes";
import columnRoutes from "./routes/column.routes";
import recordRoutes from "./routes/record.routes";
import recordValueRoutes from "./routes/recordValue.routes";

const app = express();

app.use(cors());

app.use(express.json());


// Routes
app.use("/api/auth", authRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/workspace-members", workspaceMemberRoutes);
app.use("/api/modules", moduleRoutes);
app.use("/api/collections", collectionRoutes);
app.use("/api/columns", columnRoutes);
app.use("/api/records", recordRoutes);
app.use("/api/record-values", recordValueRoutes);


export default app;