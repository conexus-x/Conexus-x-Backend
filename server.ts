import dotenv from "dotenv";
import app from "./app";
import connectDB from "./config/db";
import env from "./config/env";
import { syncActivityRetention } from "./models/Activity";
dotenv.config();

// The TTL window lives inside the index, so it has to be reconciled with
// ACTIVITY_RETENTION_DAYS on every boot — see models/Activity.ts.
connectDB().then(() => syncActivityRetention());


app.listen(env.port, () => {
    console.log(`Server-> http://localhost:${env.port}`);
});
