import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "";

async function cleanupOldCollections() {
  if (!MONGO_URI) {
    console.error("MONGO_URI not found");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB...");

    const db = mongoose.connection.db;
    if (!db) {
      console.error("Database connection not ready");
      process.exit(1);
    }

    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map((c) => c.name);
    console.log("Existing collections:", collectionNames);

    for (const name of collectionNames) {
      await db.dropCollection(name);
      console.log(`Successfully dropped collection: ${name}`);
    }

    console.log("Cleanup complete!");
    process.exit(0);
  } catch (error) {
    console.error("Error during cleanup:", error);
    process.exit(1);
  }
}

cleanupOldCollections();
