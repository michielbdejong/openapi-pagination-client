/**
 * Request builder.
 *
 * Translates high-level pagination intent (e.g. "go to page 3") into
 * concrete PaginationRequestParams (query parameters, body fields, headers)
 * based on a resolved PaginationSchemeObject.
 *
 * The builder works by scanning the scheme's request field map for fields
 * whose `role` matches the requested operation, then injecting the value
 * under the appropriate parameter name.
 */

import type {
  PaginationSchemeObject,
  PaginationRequestParams,
  RequestRole,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyParams(): PaginationRequestParams {
  return { queryParameters: {}, bodyFields: {}, headerFields: {} };
}

/**
 * Finds the first field name in the scheme's request map whose role matches
 * the given role, searching across queryParameters, bodyFields, and
 * headerFields in that order (or a specific location if supplied).
 */
function findFieldByRole(
  scheme: PaginationSchemeObject,
  role: RequestRole,
): { location: "queryParameters" | "bodyFields" | "headerFields"; name: string } | null {
  for (const location of [
    "queryParameters",
    "bodyFields",
    "headerFields",
  ] as const) {
    const map = scheme.request?.[location] ?? {};
    for (const [name, field] of Object.entries(map)) {
      if (field.role === role) return { location, name };
    }
  }
  return null;
}

function injectValue(
  params: PaginationRequestParams,
  location: "queryParameters" | "bodyFields" | "headerFields",
  name: string,
  value: string | number,
): void {
  if (location === "headerFields") {
    params.headerFields[name] = String(value);
  } else if (location === "queryParameters") {
    params.queryParameters[name] = value;
  } else {
    params.bodyFields[name] = value;
  }
}

// ---------------------------------------------------------------------------
// Per-scheme-type builders
// ---------------------------------------------------------------------------

/**
 * Builds request params for a pageNumber scheme.
 *
 * @param scheme  The resolved scheme object.
 * @param page    The 1-indexed page number to request.
 * @param pageSize Optional page size hint.
 */
function buildPageNumberParams(
  scheme: PaginationSchemeObject,
  page: number,
  pageSize?: number,
): PaginationRequestParams {
  const params = emptyParams();

  const pageField = findFieldByRole(scheme, "page");
  if (pageField) {
    injectValue(params, pageField.location, pageField.name, page);
  }

  if (pageSize !== undefined) {
    const sizeField = findFieldByRole(scheme, "pageSize");
    if (sizeField) {
      injectValue(params, sizeField.location, sizeField.name, pageSize);
    }
  }

  return params;
}

/**
 * Builds request params for a pageToken scheme.
 *
 * @param scheme     The resolved scheme object.
 * @param token      The continuation token from the previous response (null for page 1).
 * @param pageSize   Optional page size hint.
 */
function buildPageTokenParams(
  scheme: PaginationSchemeObject,
  token: string | null,
  pageSize?: number,
): PaginationRequestParams {
  const params = emptyParams();

  if (token !== null) {
    // Try role="pageToken" first, then role="cursor" (synonymous per spec §4.5)
    const tokenField =
      findFieldByRole(scheme, "pageToken") ?? findFieldByRole(scheme, "cursor");
    if (tokenField) {
      injectValue(params, tokenField.location, tokenField.name, token);
    }
  }

  if (pageSize !== undefined) {
    const sizeField = findFieldByRole(scheme, "pageSize");
    if (sizeField) {
      injectValue(params, sizeField.location, sizeField.name, pageSize);
    }
  }

  return params;
}

/**
 * Builds request params for a nextLink scheme.
 *
 * For the first page: optionally injects a pageSize hint.
 * For subsequent pages: the caller simply follows the nextLink URL directly;
 * this builder returns empty params (the URL encodes all state).
 *
 * @param scheme     The resolved scheme object.
 * @param isFirstPage True when requesting the first page (no link yet).
 * @param pageSize   Optional page size hint (first page only).
 */
function buildNextLinkParams(
  scheme: PaginationSchemeObject,
  isFirstPage: boolean,
  pageSize?: number,
): PaginationRequestParams {
  const params = emptyParams();

  if (isFirstPage && pageSize !== undefined) {
    const sizeField = findFieldByRole(scheme, "pageSize");
    if (sizeField) {
      injectValue(params, sizeField.location, sizeField.name, pageSize);
    }
  }

  // Subsequent pages: caller should use the nextLink URL directly.
  return params;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildFirstPageOptions {
  /** Page size hint — injected if the scheme defines a pageSize field. */
  pageSize?: number;
}

export interface BuildNextPageOptions {
  /** The PaginationResponseState from the previous page. */
  previousToken: string | null;
  previousPage: number | null;
  pageSize?: number;
}

/**
 * Builds the PaginationRequestParams for the *first* page of a paginated
 * request. Works for all three scheme types.
 */
export function buildFirstPageParams(
  scheme: PaginationSchemeObject,
  options: BuildFirstPageOptions = {},
): PaginationRequestParams {
  switch (scheme.type) {
    case "pageNumber":
      return buildPageNumberParams(scheme, 1, options.pageSize);

    case "pageToken":
      // First page: no token
      return buildPageTokenParams(scheme, null, options.pageSize);

    case "nextLink":
      return buildNextLinkParams(scheme, true, options.pageSize);
  }
}

/**
 * Builds the PaginationRequestParams for the *next* page given state
 * extracted from the previous response.
 *
 * Returns null if there is no next page available.
 */
export function buildNextPageParams(
  scheme: PaginationSchemeObject,
  options: BuildNextPageOptions,
): PaginationRequestParams | null {
  switch (scheme.type) {
    case "pageNumber": {
      if (options.previousPage === null) return null;
      return buildPageNumberParams(
        scheme,
        options.previousPage + 1,
        options.pageSize,
      );
    }

    case "pageToken": {
      if (options.previousToken === null) return null;
      return buildPageTokenParams(scheme, options.previousToken, options.pageSize);
    }

    case "nextLink":
      // The caller must use the nextLink URL directly, not query params.
      // We return empty params to signal "use the link you were given".
      return emptyParams();
  }
}

/**
 * Applies PaginationRequestParams to a URL and a mutable headers object.
 *
 * - queryParameters are appended to the URL's search params.
 * - headerFields are merged into the headers object.
 * - bodyFields are returned separately (caller merges into request body).
 *
 * @returns The modified URL string and the extracted bodyFields.
 */
export function applyParamsToRequest(
  baseUrl: string,
  params: PaginationRequestParams,
  headers: Record<string, string> = {},
): {
  url: string;
  headers: Record<string, string>;
  bodyFields: Record<string, string | number>;
} {
  const url = new URL(baseUrl);

  for (const [key, value] of Object.entries(params.queryParameters)) {
    url.searchParams.set(key, String(value));
  }

  const mergedHeaders = { ...headers, ...params.headerFields };

  return {
    url: url.toString(),
    headers: mergedHeaders,
    bodyFields: params.bodyFields,
  };
}
