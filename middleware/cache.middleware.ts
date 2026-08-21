import { Request, Response, NextFunction } from "express";

/**
 * Tenant data must never sit in a shared cache, but it should still be
 * revalidatable: `must-revalidate` + Express's default ETag means a repeat GET
 * costs a 304 with no body instead of a full payload.
 */
export const apiCacheHeaders = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (req.method === "GET") {
        res.set("Cache-Control", "private, max-age=0, must-revalidate");
        res.set("Vary", "Authorization");
    } else {
        res.set("Cache-Control", "no-store");
    }

    next();
};
