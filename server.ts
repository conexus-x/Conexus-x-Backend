import dotenv from "dotenv";
import app from "./app";
import connectDB from "./config/db";
import env from "./config/env";
dotenv.config();

connectDB()


app.listen(env.port, () => {
    console.log(`Server-> http://localhost:${env.port}`);
});