const dotenv = require('dotenv');

dotenv.config();

const port = process.env.PORT || 4040;

const env = {
    port,
    mongo_url: process.env.MONGO_URI,
    jwt_secret: process.env.JWT_SECRET,
    client_url: process.env.CLIENT_URL || "http://localhost:3000",
    google_client_id: process.env.GOOGLE_CLIENT_ID,
    google_client_secret: process.env.GOOGLE_CLIENT_SECRET,
    google_redirect_uri:
        process.env.GOOGLE_REDIRECT_URI ||
        `http://localhost:${port}/api/auth/google/callback`,

    cloudinary_cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    cloudinary_api_key: process.env.CLOUDINARY_API_KEY,
    cloudinary_api_secret: process.env.CLOUDINARY_API_SECRET,
    cloudinary_folder: process.env.CLOUDINARY_FOLDER || "crm",

    /**
     * How many days of activity history to keep. This is THE knob — change it
     * here (or via ACTIVITY_RETENTION_DAYS) and the TTL index is rebuilt to
     * match on the next boot. Set to 0 to keep activity forever.
     */
    activity_retention_days: Number(process.env.ACTIVITY_RETENTION_DAYS ?? 90),

    /**
     * Atlas, the chat agent. The key is read here and used only by
     * services/agent.service.ts — never logged, never returned to a client.
     *
     * The model is a knob on purpose: Haiku 4.5 is the cheapest model that
     * calls tools reliably ($1/$5 per million in/out), which is what this agent
     * does all day. Point ANTHROPIC_MODEL at claude-sonnet-5 or claude-opus-5
     * if you want more reasoning per turn and are willing to pay for it.
     */
    anthropic_api_key: process.env.ANTHROPIC_API_KEY,
    anthropic_model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",

    /**
     * Ceiling per reply, NOT a budget: you are billed for what the model
     * actually writes, so a high cap costs nothing on a one-line answer. It was
     * 400, which silently truncated create_blueprint mid-JSON — the tool call
     * never completed and the turn died with a confusing message. Terseness is
     * the system prompt's job; this only stops a runaway.
     */
    anthropic_max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS ?? 2000),

    /** Tool-call rounds per message — the real cost ceiling for one request. */
    anthropic_max_steps: Number(process.env.ANTHROPIC_MAX_STEPS ?? 4),
}

module.exports = env;
