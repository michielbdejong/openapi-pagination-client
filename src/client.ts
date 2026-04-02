/**
 * PaginatedClient — high-level API client with built-in pagination support.
 *
 * Usage:
 *
 *   const client = new PaginatedClient({
 *     baseUrl: "https://api.example.com",
 *     schemes: myPaginationSchemesMap,
 *     fetcher: (url, init) => fetch(url, init),
 *   });
 *
 *   // Fetch a single page
 *   const page = await client.fetchPage<Product>("/products", "pageNumberPagination");
 *
 *   // Iterate over all pages with an async generator
 *   for await (const page of client.pages<Product>("/products", "pageNumberPagination")) {
 *     process(page.items);
 *   }
 *
 *   // Collect every item across all pages
 *   const allProducts = await client.collectAll<Product>("/products", "pageNumberPagination");
 */

import type {
  PaginationSchemesMap,
  OperationDescriptor,
  Page,
  PaginationRequestParams,
  PaginationSchemeObject,
} from "./types.js";
import { validateSchemesMap } from "./validation.js";
import { resolveEffectiveSchemes } from "./autodetect.js";
import { buildFirstPageParams, applyParamsToRequest } from "./request-builder.js";
import { parseResponse, buildNextFromState } from "./response-parser.js";

// ---------------------------------------------------------------------------
// Fetcher abstraction
// ---------------------------------------------------------------------------

export interface FetcherInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type Fetcher = (
  url: string,
  init?: FetcherInit,
) => Promise<{ body: Record<string, unknown>; headers: Record<string, string> }>;

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface PaginatedClientOptions {
  /** Base URL prepended to all relative paths. */
  baseUrl: string;

  /** The paginationSchemes map from components.paginationSchemes. */
  schemes: PaginationSchemesMap;

  /**
   * HTTP fetcher function. Defaults to a global-fetch wrapper.
   * Inject a custom fetcher in tests to avoid real network calls.
   */
  fetcher?: Fetcher;

  /** Default page size injected when the scheme supports it. */
  defaultPageSize?: number;

  /** Validate schemes on construction. Default: true. */
  validate?: boolean;
}

export interface FetchPageOptions {
  /** Override the page size for this specific request. */
  pageSize?: number;
  /** Extra headers to include in the request. */
  headers?: Record<string, string>;
  /** For nextLink scheme: supply the explicit next URL instead of baseUrl+path. */
  nextUrl?: string;
  /** For pageNumber scheme: jump to a specific page. */
  page?: number;
  /** For pageToken scheme: supply the continuation token. */
  pageToken?: string;
  /** Item extractor. By default, looks for a field with role=nextPageToken or an `items` / `data` / `results` array at the top level. */
  itemsField?: string;
}

// ---------------------------------------------------------------------------
// Default global fetch adapter
// ---------------------------------------------------------------------------

function defaultFetcher(): Fetcher {
  return async (url, init) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const globalFetch = (globalThis as any).fetch as typeof fetch | undefined;
    if (!globalFetch) {
      throw new Error(
        "No global fetch available. Please supply a custom fetcher via PaginatedClientOptions.fetcher.",
      );
    }
    const response = await globalFetch(url, init as RequestInit);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} — ${url}`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { body, headers };
  };
}

// ---------------------------------------------------------------------------
// Item extraction heuristic
// ---------------------------------------------------------------------------

const COMMON_ITEMS_FIELDS = ["items", "data", "results", "records", "content"];

function extractItems<T>(
  body: Record<string, unknown>,
  itemsField?: string,
): T[] {
  if (itemsField) {
    const val = body[itemsField];
    return Array.isArray(val) ? (val as T[]) : [];
  }
  for (const field of COMMON_ITEMS_FIELDS) {
    const val = body[field];
    if (Array.isArray(val)) return val as T[];
  }
  // Fallback: if the body itself is an array (rare but valid)
  return [];
}

// ---------------------------------------------------------------------------
// PaginatedClient
// ---------------------------------------------------------------------------

export class PaginatedClient {
  private readonly schemes: PaginationSchemesMap;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly defaultPageSize?: number;

  constructor(options: PaginatedClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.schemes = options.schemes;
    this.fetcher = options.fetcher ?? defaultFetcher();
    this.defaultPageSize = options.defaultPageSize;

    if (options.validate !== false) {
      validateSchemesMap(this.schemes);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scheme resolution
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns the resolved scheme by name (after validation).
   * Throws if the scheme does not exist.
   */
  getScheme(schemeName: string): PaginationSchemeObject {
    const scheme = this.schemes[schemeName];
    if (!scheme) {
      throw new Error(
        `Pagination scheme "${schemeName}" is not defined in the schemes map.`,
      );
    }
    return scheme;
  }

  /**
   * Returns the scheme names that would apply to a given operation
   * via auto-detection.
   */
  detectSchemesForOperation(operation: OperationDescriptor): string[] {
    return resolveEffectiveSchemes(this.schemes, operation).map(
      (e) => e.schemeName,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core fetch
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetches a single page from the API.
   *
   * @param path        URL path (appended to baseUrl) or an absolute URL.
   * @param schemeName  Name of the pagination scheme to use.
   * @param params      Pre-built PaginationRequestParams (from a previous page).
   *                    Pass null / undefined to fetch the first page.
   * @param options     Optional per-request overrides.
   */
  async fetchPage<T>(
    path: string,
    schemeName: string,
    params?: PaginationRequestParams | null,
    options: FetchPageOptions = {},
  ): Promise<Page<T>> {
    const scheme = this.getScheme(schemeName);
    const pageSize = options.pageSize ?? this.defaultPageSize;

    // Determine effective params
    let effectiveParams: PaginationRequestParams;

    if (params) {
      effectiveParams = params;
    } else if (options.page !== undefined && scheme.type === "pageNumber") {
      // Jump to specific page
      const { buildPageNumberParamsDirect } = await import("./request-builder.js") as {
        buildPageNumberParamsDirect?: (s: PaginationSchemeObject, page: number, pageSize?: number) => PaginationRequestParams;
      };
      // Fall back to inline construction
      effectiveParams = buildFirstPageParams(scheme, { pageSize });
      // Override the page number field
      const pageField = this.findRequestFieldByRole(scheme, "page");
      if (pageField && options.page !== 1) {
        effectiveParams.queryParameters[pageField] = options.page;
      }
    } else if (options.pageToken !== undefined && scheme.type === "pageToken") {
      const { buildNextPageParams } = await import("./request-builder.js");
      effectiveParams = buildNextPageParams(scheme, {
        previousToken: options.pageToken,
        previousPage: null,
        pageSize,
      }) ?? buildFirstPageParams(scheme, { pageSize });
    } else {
      effectiveParams = buildFirstPageParams(scheme, { pageSize });
    }

    // Build URL — nextUrl overrides path entirely when it's an absolute URL
    const rawUrl = options.nextUrl
      ? options.nextUrl
      : path.startsWith("http")
        ? path
        : `${this.baseUrl}${path}`;
    const { url, headers, bodyFields } = applyParamsToRequest(
      rawUrl,
      effectiveParams,
      options.headers,
    );

    // Perform fetch
    const hasBodyFields = Object.keys(bodyFields).length > 0;
    const fetcherInit: FetcherInit = {
      method: hasBodyFields ? "POST" : "GET",
      headers,
    };
    if (hasBodyFields) {
      fetcherInit.body = JSON.stringify(bodyFields);
      fetcherInit.headers = {
        "Content-Type": "application/json",
        ...headers,
      };
    }

    const { body: responseBody, headers: responseHeaders } = await this.fetcher(
      url,
      fetcherInit,
    );

    // Parse pagination state from response
    const paginationState = parseResponse(scheme, responseBody, responseHeaders);

    // Build next-page params
    const nextPageParams = buildNextFromState(scheme, paginationState, pageSize);

    // Extract items
    const items = extractItems<T>(responseBody, options.itemsField);

    return { items, pagination: paginationState, nextPageParams };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Async generator — iterate over all pages
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Async generator that yields one Page<T> per server response.
   * Iteration stops when hasNextPage is false.
   *
   * For nextLink schemes, the next URL is followed automatically.
   * For pageNumber and pageToken schemes, nextPageParams drives the next fetch.
   */
  async *pages<T>(
    path: string,
    schemeName: string,
    options: FetchPageOptions = {},
  ): AsyncGenerator<Page<T>> {
    const scheme = this.getScheme(schemeName);
    let currentParams: PaginationRequestParams | null = null;
    let nextUrl: string | undefined = options.nextUrl;
    let isFirst = true;

    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any

      const page: Page<T> = await this.fetchPage<T>(
        path,
        schemeName,
        isFirst ? null : currentParams,
        { ...options, nextUrl },
      );

      yield page;
      isFirst = false;

      if (!page.pagination.hasNextPage) break;

      // Update state for next iteration
      if (scheme.type === "nextLink" && page.pagination.nextLink) {
        // For nextLink: use the full URL directly, ignoring path
        nextUrl = page.pagination.nextLink;
        currentParams = null;
      } else {
        nextUrl = undefined;
        currentParams = page.nextPageParams;
        if (!currentParams) break;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Convenience — collect all items across all pages
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetches all pages and returns a flat array of all items.
   *
   * ⚠ Use with caution on large result sets — this buffers everything
   * in memory. Prefer the `pages()` generator for streaming-style processing.
   */
  async collectAll<T>(
    path: string,
    schemeName: string,
    options: FetchPageOptions = {},
  ): Promise<T[]> {
    const all: T[] = [];
    for await (const page of this.pages<T>(path, schemeName, options)) {
      all.push(...page.items);
    }
    return all;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────────

  private findRequestFieldByRole(
    scheme: PaginationSchemeObject,
    role: string,
  ): string | null {
    for (const map of [
      scheme.request?.queryParameters ?? {},
      scheme.request?.bodyFields ?? {},
    ]) {
      for (const [name, field] of Object.entries(map)) {
        if (field.role === role) return name;
      }
    }
    return null;
  }
}
