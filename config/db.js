const mongoose = require("mongoose");
const env = require("./env");

const connectDB = async () => {
    try {
        await mongoose.connect(env.mongo_url);

        console.log("✅ MongoDB Connected");
    } catch (error) {
        console.error("❌ MongoDB Connection Failed:", error.message);
        process.exit(1);
    }
};

module.exports = connectDB;