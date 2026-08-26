import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

/**
 * One-time repair for the `systemKey_1` unique index — which currently blocks
 * every new signup.
 *
 * THE BUG
 * -------
 * models/User.ts declared systemKey as `unique: true, sparse: true, default: null`.
 * Those three do not compose the way the comment on the field assumed. A SPARSE
 * index skips documents where the field is MISSING; it does not skip documents
 * where the field is explicitly `null` — an explicit null is a value, and it
 * gets indexed like any other. `default: null` guarantees every real user is
 * written with exactly that value, so the second human account collides with
 * the first:
 *
 *   E11000 duplicate key error ... index: systemKey_1 dup key: { systemKey: null }
 *
 * Older accounts predate the default and have the field absent, which is why
 * the collection ended up with a mix — those are the ones sparse really was
 * skipping, and why this went unnoticed until a fresh registration was tried.
 *
 * THE FIX
 * -------
 * A PARTIAL index instead of a sparse one. `$type: "string"` covers exactly the
 * bot accounts the uniqueness is meant to protect (see SYSTEM_USER_KEYS) and
 * ignores null and missing alike, so any number of humans coexist. The schema
 * no longer writes a default, so new users have the field absent.
 *
 * This script is idempotent: run it as many times as you like.
 *
 *   npx ts-node scripts/fix_system_key_index.ts
 */

const INDEX_NAME = "systemKey_1";

const run = async () => {
    const uri = process.env.MONGO_URI;

    if (!uri) {
        throw new Error("MONGO_URI is not set");
    }

    await mongoose.connect(uri);

    const users = mongoose.connection.collection("users");

    // 1. Explicit nulls become absent. This is what lets the unique index be
    //    rebuilt at all — and it is safe, because `null` and "missing" mean the
    //    identical thing here: not a bot.
    const cleared = await users.updateMany(
        { systemKey: null },
        { $unset: { systemKey: "" } }
    );

    console.log(`unset explicit systemKey:null on ${cleared.modifiedCount} user(s)`);

    // 2. Drop the old index if it is still the sparse one.
    const existing = await users.indexes();
    const current = existing.find((index) => index.name === INDEX_NAME);

    if (current && !current.partialFilterExpression) {
        await users.dropIndex(INDEX_NAME);
        console.log(`dropped old ${INDEX_NAME} (sparse)`);
    } else if (current) {
        console.log(`${INDEX_NAME} is already partial — leaving it`);
    } else {
        console.log(`${INDEX_NAME} not present`);
    }

    // 3. Recreate it as a partial index over real bot keys only.
    await users.createIndex(
        { systemKey: 1 },
        {
            name: INDEX_NAME,
            unique: true,
            partialFilterExpression: { systemKey: { $type: "string" } }
        }
    );

    console.log(`created ${INDEX_NAME} (unique, partial on $type:"string")`);

    const bots = await users.countDocuments({ systemKey: { $type: "string" } });
    const humans = await users.countDocuments({ systemKey: { $exists: false } });

    console.log(`\nbots: ${bots}   humans: ${humans}`);

    await mongoose.disconnect();
};

run()
    .then(() => {
        console.log("done");
        process.exit(0);
    })
    .catch((error) => {
        console.error("failed:", error.message);
        process.exit(1);
    });
