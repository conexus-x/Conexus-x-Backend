import crypto from "crypto";
import jwt from "jsonwebtoken";
import env from "../config/env";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export type OAuthMode = "login" | "register";

// env is plain JS, so every value arrives as string | undefined — fail loudly at use time
const requireEnv = (value: string | undefined, name: string): string => {
    if (!value) {
        throw new Error(`Missing environment variable: ${name}`);
    }
    return value;
};

const clientId = () => requireEnv(env.google_client_id, "GOOGLE_CLIENT_ID");
const clientSecret = () => requireEnv(env.google_client_secret, "GOOGLE_CLIENT_SECRET");
const stateSecret = () => requireEnv(env.jwt_secret, "JWT_SECRET");

export interface GoogleProfile {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
}

export const isGoogleConfigured = (): boolean =>
    Boolean(env.google_client_id && env.google_client_secret);

// Stateless CSRF guard: a short-lived signed token that also carries the entry point.
export const createOAuthState = (mode: OAuthMode): string =>
    jwt.sign(
        { nonce: crypto.randomBytes(16).toString("hex"), mode },
        stateSecret(),
        { expiresIn: "10m" }
    );

export const verifyOAuthState = (state: unknown): OAuthMode => {
    const decoded = jwt.verify(String(state ?? ""), stateSecret()) as {
        mode?: OAuthMode;
    };
    return decoded.mode === "register" ? "register" : "login";
};

/**
 * The redirect URI, ALWAYS a string.
 *
 * config/env.js is plain JavaScript, so TypeScript infers every
 * `process.env.X` read as `string | undefined`. URLSearchParams only accepts
 * Record<string, string>, so the moment that file loses an `||` fallback the
 * whole backend stops compiling — which has now happened three times.
 *
 * Coercing HERE, at the point of use, ends that: this file compiles and runs
 * whether or not env.js carries a default, so editing the config can no longer
 * break the build. The fallback is also repeated here so an unset variable
 * still produces a working local URL rather than an empty one.
 */
const redirectUri = (): string =>
    String(
        env.google_redirect_uri
    );

export const buildGoogleAuthUrl = (state: string): string => {
    const params = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: redirectUri(),
        response_type: "code",
        scope: "openid email profile",
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "select_account",
        state
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
};

export const exchangeCodeForTokens = async (
    code: string
): Promise<{ access_token: string; id_token?: string }> => {
    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: clientId(),
            client_secret: clientSecret(),
            redirect_uri: redirectUri(),
            grant_type: "authorization_code"
        })
    });

    if (!response.ok) {
        throw new Error(`Google token exchange failed (${response.status})`);
    }

    return response.json() as Promise<{ access_token: string; id_token?: string }>;
};

export const fetchGoogleProfile = async (
    accessToken: string
): Promise<GoogleProfile> => {
    const response = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        throw new Error(`Google profile fetch failed (${response.status})`);
    }

    return response.json() as Promise<GoogleProfile>;
};
