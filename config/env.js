const dotenv = require('dotenv');

dotenv.config();

const port = process.env.PORT || 4040;

const env = {
    port,
    mongo_url: process.env.MONGO_URI,
    jwt_secret: process.env.JWT_SECRET,
    /**
     * The FRONTEND origin — where the browser is sent after Google signs
     * someone in (`${site_url}/auth/callback#token=...`). Named SITE_URL to
     * match the frontend's own NEXT_PUBLIC_SITE_URL.
     *
     * The localhost fallback keeps a fresh clone working with no setup. It is
     * ONLY a dev convenience: on a deployment SITE_URL must be set, or this
     * falls through and sends real users to a localhost that is not running.
     */
    site_url: process.env.SITE_URL,
    google_client_id: process.env.GOOGLE_CLIENT_ID,
    google_client_secret: process.env.GOOGLE_CLIENT_SECRET,
    /**
     * Where GOOGLE returns the browser. Must match a URI registered on the
     * OAuth client byte-for-byte. Same rule as site_url: the localhost fallback
     * is a dev convenience, and a deployment must set it explicitly.
     */
    google_redirect_uri:
        process.env.GOOGLE_REDIRECT_URI ||
        `http://localhost:${port}/api/auth/google/callback`,

    /**
     * Mail transport for signup codes.
     *
     * Read HERE rather than in the service, for the reason every other setting
     * is: this module calls dotenv.config() itself, at the top, before anything
     * reads process.env. services/otp.service.ts used to read process.env
     * directly and was evaluated through server.ts's import graph BEFORE its
     * dotenv.config() line ever ran, so every MAIL_* lookup came back undefined
     * and sends died on localhost:587. Going through env removes that whole
     * class of bug, and it is where the codebase already keeps configuration.
     *
     * Host and port are defaulted because they are per-provider facts, not
     * secrets; user and password have no default and must come from .env.
     */
    mail_host: process.env.MAIL_HOST || "smtp.gmail.com",
    mail_port: Number(process.env.MAIL_PORT) || 465,
    mail_user: process.env.MAIL_USER,
    mail_password: process.env.MAIL_PASSWORD,
    /** Most relays reject a missing From, so fall back to the mailbox itself. */
    mail_from: process.env.MAIL_FROM || process.env.MAIL_USER,
    /**
     * Implicit TLS on 465, STARTTLS on 587 — derived from the port so the two
     * cannot be set inconsistently. MAIL_SECURE overrides for anything exotic.
     */
    mail_secure:
        process.env.MAIL_SECURE !== undefined
            ? process.env.MAIL_SECURE === "true"
            : (Number(process.env.MAIL_PORT) || 465) === 465,

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
     * Aquiline, the chat agent. The key is read here and used only by
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

    /**
     * Aquiline credit allowances per plan, per month. 1 credit = $0.0001, so
     * these read as: free $0.05, paid $1.00, enterprise $5.00.
     *
     * Here rather than on each user document so the free tier can be retuned
     * against the real bill with a restart instead of a migration over every
     * free row. See services/aiCredits.service.ts for why the ledger is
     * denominated in money rather than in messages.
     *
     * Sized against a $5 total budget: a typical Haiku turn is 30-40 credits,
     * which puts free at roughly 14 turns a month and paid at roughly 280.
     */
    ai_credits_free: Number(process.env.AI_CREDITS_FREE ?? 500),
    ai_credits_paid: Number(process.env.AI_CREDITS_PAID ?? 10000),
    ai_credits_enterprise: Number(process.env.AI_CREDITS_ENTERPRISE ?? 50000),
}

module.exports = env;
