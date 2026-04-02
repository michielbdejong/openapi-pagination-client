/**
 * Response parser.
 *
 * Extracts PaginationResponseState from a server response by scanning the
 * scheme's response field map (bodyFields and headers) for fields with known
 * roles and reading the corresponding values.
 *
 * Supports all three scheme types:
 *   - pageNumber  → currentPage, totalCount, totalPages, pageSize
 *   - pageToken   → nextPageToken / nextCursor
 *   - nextLink    → nextLink (body field or response header)
 */

import type {
  PaginationSchemeObject,
  PaginationResponseState,
  PaginationRequestParams,
  ResponseRole,
} from "./types.js";
import { buildNextPageParams } from "./request-builder.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function emptyState(): PaginationResponseState {
  return {
    nextPageToken: null,
    nextLink: null,
    currentPage: null,
    totalCount: null,
    totalPages: null,
    pageSize: null,
    hasNextPage: false,
  };
}

/**
 * Safely reads a nested path from a plain object (dot-separated key not
 * supported — keys are flat, matching the OAS body field property names).
 */
function readBodyField(
  body: Record<string, unknown>,
  fieldName: string,
): unknown {
  return body[fieldName];
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

/**
 * Parses an RFC 8288 Link header value and extracts the URL with rel="next".
 *
 * Example input:
 *   <https://api.example.com/items?page=2>; rel="next", <...>; rel="prev"
 */
export function parseLinkHeader(header: string): string | null {
  if (!header) return null;

  // Split on commas that precede an angle bracket (next link entry)
  const parts = header.split(/,\s*(?=<)/);

  for (const part of parts) {
    // Extract URL between < > and everything after the first semicolon
    const urlMatch = part.match(/^\s*<([^>]+)>(.*)/);
    if (!urlMatch) continue;
    const url = urlMatch[1]!;
    const attrs = urlMatch[2]!;

    // Find rel="next" or rel=next anywhere in the attributes string
    const relMatch = attrs.match(/\brel\s*=\s*"?([^";,\s]+)"?/i);
    if (relMatch && relMatch[1]!.trim().toLowerCase() === "next") {
      return url;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Role-indexed extraction
// ---------------------------------------------------------------------------

/**
 * Extracts all fields by role from the scheme's response definition,
 * reading values from the actual response body and headers.
 */
function extractByRole(
  scheme: PaginationSchemeObject,
  responseBody: Record<string, unknown>,
  responseHeaders: Record<string, string>,
): Map<ResponseRole, unknown> {
  const roleValues = new Map<ResponseRole, unknown>();

  // Body fields
  for (const [fieldName, fieldDef] of Object.entries(
    scheme.response?.bodyFields ?? {},
  )) {
    if (!fieldDef.role) continue;
    const value = readBodyField(responseBody, fieldName);
    if (value !== undefined) {
      roleValues.set(fieldDef.role as ResponseRole, value);
    }
  }

  // Response headers
  for (const [headerName, fieldDef] of Object.entries(
    scheme.response?.headers ?? {},
  )) {
    if (!fieldDef.role) continue;
    // Header lookups are case-insensitive (HTTP/1.1 §4.2)
    const headerValue =
      responseHeaders[headerName] ??
      responseHeaders[headerName.toLowerCase()] ??
      responseHeaders[headerName.toUpperCase()];

    if (headerValue !== undefined) {
      if (fieldDef.role === "nextLink") {
        // Always parse as RFC 8288 Link header and extract rel="next" only.
        // If no rel=next is found, do not set a value (this is not the next link).
        const parsed = parseLinkHeader(headerValue);
        if (parsed) roleValues.set("nextLink", parsed);
      } else {
        roleValues.set(fieldDef.role as ResponseRole, headerValue);
      }
    }
  }

  return roleValues;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a server response and returns PaginationResponseState.
 *
 * @param scheme          The resolved effective scheme for this operation.
 * @param responseBody    Parsed JSON response body (must be a plain object).
 * @param responseHeaders Response headers as a plain string→string map.
 */
export function parseResponse(
  scheme: PaginationSchemeObject,
  responseBody: Record<string, unknown>,
  responseHeaders: Record<string, string> = {},
): PaginationResponseState {
  const state = emptyState();
  const roles = extractByRole(scheme, responseBody, responseHeaders);

  // nextPageToken (also covers nextCursor synonym)
  const token =
    roles.get("nextPageToken") ?? roles.get("nextCursor") ?? null;
  state.nextPageToken = toStringOrNull(token);

  // nextLink
  state.nextLink = toStringOrNull(roles.get("nextLink") ?? null);

  // currentPage
  state.currentPage = toNumberOrNull(roles.get("currentPage") ?? null);

  // totalCount
  state.totalCount = toNumberOrNull(roles.get("totalCount") ?? null);

  // totalPages
  state.totalPages = toNumberOrNull(roles.get("totalPages") ?? null);

  // pageSize (server-confirmed)
  state.pageSize = toNumberOrNull(roles.get("pageSize") ?? null);

  // Determine hasNextPage
  state.hasNextPage = deriveHasNextPage(scheme.type, state);

  return state;
}

/**
 * Derives hasNextPage from the available state signals for each scheme type.
 *
 * Rules:
 *   pageToken  → hasNextPage iff nextPageToken is non-null
 *   nextLink   → hasNextPage iff nextLink is non-null
 *   pageNumber → hasNextPage iff:
 *                  totalPages is known and currentPage < totalPages, OR
 *                  totalCount and pageSize known and there are more items
 */
function deriveHasNextPage(
  type: PaginationSchemeObject["type"],
  state: PaginationResponseState,
): boolean {
  switch (type) {
    case "pageToken":
      return state.nextPageToken !== null;

    case "nextLink":
      return state.nextLink !== null;

    case "pageNumber":
      if (state.currentPage !== null && state.totalPages !== null) {
        return state.currentPage < state.totalPages;
      }
      if (
        state.currentPage !== null &&
        state.totalCount !== null &&
        state.pageSize !== null
      ) {
        const fetchedUpTo = state.currentPage * state.pageSize;
        return fetchedUpTo < state.totalCount;
      }
      // Not enough info — conservatively assume there may be more
      return false;
  }
}

/**
 * Builds the PaginationRequestParams for the next page from parsed state.
 * Returns null if there is no next page.
 */
export function buildNextFromState(
  scheme: PaginationSchemeObject,
  state: PaginationResponseState,
  pageSize?: number,
): PaginationRequestParams | null {
  if (!state.hasNextPage) return null;

  return buildNextPageParams(scheme, {
    previousToken: state.nextPageToken,
    previousPage: state.currentPage,
    pageSize,
  });
}
