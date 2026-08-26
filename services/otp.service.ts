import nodemailer from "nodemailer";
import env from "../config/env";

/**
 * Mail transport for signup codes.
 *
 * NOTHING IS HARDCODED HERE. Host, port, TLS mode, credentials and the From
 * address all come from config/env.js, which is the one place this codebase
 * reads configuration — and, importantly, the one module that calls
 * dotenv.config() itself before touching process.env.
 *
 * That second point is not incidental. This file used to read process.env
 * directly with its own literal fallbacks, and server.ts calls dotenv.config()
 * in its BODY — after the imports, which are hoisted. So the transport was
 * built before the .env file had been read at all, every MAIL_* lookup returned
 * undefined, and sends failed with `connect ECONNREFUSED 127.0.0.1:587`: a
 * message that reads like a network fault and is really missing configuration.
 * Going through env removes the whole class of bug.
 */

/** True when there is enough configuration to attempt a send at all. */
export const isMailConfigured = () =>
    Boolean(env.mail_user && env.mail_password);

export const sendOtpEmail = async (email: string, otp: string) => {
    /**
     * Fail with the actual cause.
     *
     * Without this the missing-credentials case surfaces as an authentication
     * error from the relay, which sends whoever is debugging it looking at the
     * password rather than at the fact that no password was supplied.
     */
    if (!isMailConfigured()) {
        throw new Error(
            "Mail is not configured: set MAIL_USER and MAIL_PASSWORD in .env " +
            "(and MAIL_HOST / MAIL_PORT if you are not using Gmail)."
        );
    }

    /**
     * Built per call rather than once at module load, so a config change needs
     * only a restart and never a code change. A signup code is not a hot path;
     * nodemailer pools nothing here.
     */
    const transporter = nodemailer.createTransport({
        host: env.mail_host,
        port: env.mail_port,
        secure: env.mail_secure,
        auth: {
            user: env.mail_user,
            pass: env.mail_password,
        },
    });

    await transporter.sendMail({
        from: env.mail_from,
        to: email,
        subject: "Your Conexus X verification code",
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto;">
                <h2>Verify your email</h2>

                <p>
                    Use the following code to verify your Conexus X account:
                </p>

                <div style="
                    font-size: 32px;
                    font-weight: bold;
                    letter-spacing: 10px;
                    margin: 25px 0;
                ">
                    ${otp}
                </div>

                <p>
                    This code will expire in 10 minutes.
                </p>

                <p>
                    If you didn't create an account, you can ignore this email.
                </p>
            </div>
        `,
    });
};

/**
 * A 5-digit code, matching the five boxes the register screen renders.
 *
 * Math.random is deliberate rather than crypto here: this proves control of an
 * inbox, it is not a session secret, and it lives for ten minutes. If that ever
 * changes, swap it for crypto.randomInt and nothing else has to move.
 */
export const generateOtp = () =>
    String(Math.floor(10000 + Math.random() * 90000));

/** How long a freshly issued code stays good — matches the email copy. */
export const OTP_TTL_MS = 10 * 60 * 1000;

export const otpExpiry = () => new Date(Date.now() + OTP_TTL_MS);
