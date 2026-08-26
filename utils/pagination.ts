// utils/pagination.ts

import { Request } from "express";

/**
 * Shared list-query handling for the public REST surface (the Data Console is
 * its first consumer).
 *
 * Paging is OPT-IN: a request that sends neither `limit` nor `page` gets the
 * full array and the exact response shape it always got, so the app's own
 * queries are untouched and no existing client breaks. Send either one and the
 * response grows a `pagination` block alongside the same array key.
 */

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export interface PaginationRequest {
    /** True only when the caller actually asked for a page. */
    enabled: boolean;
    page: number;
    limit: number;
    skip: number;
}

export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
    /** Feed straight back as `page`; null on the last page. */
    nextPage: number | null;
}

export const parsePagination = (query: Request["query"]): PaginationRequest => {

    const rawLimit = query.limit;
    const rawPage = query.page;

    const enabled = rawLimit !== undefined || rawPage !== undefined;

    const limit = Math.min(
        Math.max(Number(rawLimit) || DEFAULT_PAGE_SIZE, 1),
        MAX_PAGE_SIZE
    );

    const page = Math.max(Number(rawPage) || 1, 1);

    return { enabled, page, limit, skip: (page - 1) * limit };

};

export const paginationMeta = (
    total: number,
    { page, limit }: PaginationRequest
): PaginationMeta => {

    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    return {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
        nextPage: page < totalPages ? page + 1 : null
    };

};

/**
 * `sort` is matched against an allowlist per endpoint — the field name reaches a
 * Mongo sort spec, so it can never be whatever the caller typed.
 */
export const parseSort = (
    query: Request["query"],
    allowed: string[],
    fallback: Record<string, 1 | -1>
): Record<string, 1 | -1> => {

    const field = String(query.sort ?? "");

    if (!allowed.includes(field)) return fallback;

    return { [field]: String(query.order ?? "asc") === "desc" ? -1 : 1 };

};
