import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.routes";
import workspaceRoutes from "./routes/workspace.routes";
import workspaceMemberRoutes from "./routes/workspaceMember.routes";
import boardRoutes from "./routes/board.routes";
import groupRoutes from "./routes/group.route";
import columnRoutes from "./routes/column.routes";
import itemRoutes from "./routes/item.routes";
import itemValueRoutes from "./routes/itemValue.routes";

const app = express();

app.use(cors());

app.use(express.json());


// Routes
app.use("/api/auth", authRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/workspace-members", workspaceMemberRoutes);
app.use("/api/boards", boardRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/columns", columnRoutes);
app.use("/api/items", itemRoutes);
app.use("/api/item-values", itemValueRoutes);


export default app;