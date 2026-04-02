/**
 * OpenAPI Pagination Extension — Type Definitions
 * Spec version 0.1.0
 *
 * These types mirror the objects defined in the paginationSchemes specification
 * exactly. Field names, optionality, and enum values are taken verbatim from
 * the spec so that a PaginationSchemeObject can be pasted from an OAS document
 * without transformation.
 */

// ---------------------------------------------------------------------------
// 4.2  Scheme types
// ---------------------------------------------------------------------------

export type SchemeType = "pageNumber" | "pageToken" | "nextLink";

// ---------------------------------------------------------------------------
// 4.5  Semantic roles
// ---------------------------------------------------------------------------

export type RequestRole = "page" | "pageSize" | "offset" | "pageToken" | "cursor";

export type ResponseRole =
  | "nextPageToken"
  | "nextCursor"
  | "nextLink"
  | "totalCount"
  | "totalPages"
  | "pageSize"
  | "currentPage";

// ---------------------------------------------------------------------------
// 4.3.1  Request Field Object
// ---------------------------------------------------------------------------

export interface RequestFieldObject {
  description?: string;
  /** OAS Schema Object — kept as unknown so users can supply any schema dialect. */
  schema?: unknown;
  role?: RequestRole;
  /** Defaults to false per spec. */
  required?: boolean;
  /** x- extension fields */
  [key: `x-${string}`]: unknown;
}

// ---------------------------------------------------------------------------
// 4.3  Request Pagination Fields Object
// ---------------------------------------------------------------------------

export interface RequestPaginationFieldsObject {
  queryParameters?: Record<string, RequestFieldObject>;
  bodyFields?: Record<string, RequestFieldObject>;
  headerFields?: Record<string, RequestFieldObject>;
  [key: `x-${string}`]: unknown;
}

// ---------------------------------------------------------------------------
// 4.4.1  Response Field Object
// ---------------------------------------------------------------------------

export interface ResponseFieldObject {
  description?: string;
  schema?: unknown;
  role?: ResponseRole;
  [key: `x-${string}`]: unknown;
}

// ---------------------------------------------------------------------------
// 4.4  Response Pagination Fields Object
// ---------------------------------------------------------------------------

export interface ResponsePaginationFieldsObject {
  bodyFields?: Record<string, ResponseFieldObject>;
  headers?: Record<string, ResponseFieldObject>;
  [key: `x-${string}`]: unknown;
}

// ---------------------------------------------------------------------------
// 6.4  Auto-Detect Object
// ---------------------------------------------------------------------------

export interface AutoDetectObject {
  /** Match on query parameter names. Default: true */
  matchQueryParams?: boolean;
  /** Match on request body field names. Default: true */
  matchBodyFields?: boolean;
  /** Also require matching response body fields. Default: false */
  matchResponseFields?: boolean;
  /** Also require matching response headers. Default: false */
  matchHeaders?: boolean;
  /** true = ALL configured dimensions must match. Default: true */
  requireAll?: boolean;
  [key: `x-${string}`]: unknown;
}

// ---------------------------------------------------------------------------
// 4.1  Pagination Scheme Object
// ---------------------------------------------------------------------------

export interface PaginationSchemeObject {
  /** REQUIRED. One of pageNumber | pageToken | nextLink. */
  type: SchemeType;
  description?: string;
  /**
   * Controls auto-detection.
   * - true  (default) – use default rules (Section 6.3)
   * - false           – explicit annotation only
   * - AutoDetectObject – custom matching rules (Section 6.4)
   */
  autoDetect?: boolean | AutoDetectObject;
  /** At least one of request/response MUST be present. */
  request?: RequestPaginationFieldsObject;
  response?: ResponsePaginationFieldsObject;
  [key: `x-${string}`]: unknown;
}

// ---------------------------------------------------------------------------
// 5.2  Pagination Application Object
// ---------------------------------------------------------------------------

export interface PaginationApplicationObject {
  /** REQUIRED. Key into components.paginationSchemes. */
  scheme: string;
  /** Deep-merged on top of the referenced scheme. */
  overrides?: Partial<PaginationSchemeObject>;
  description?: string;
  [key: `x-${string}`]: unknown;
}

// ---------------------------------------------------------------------------
// Components / document wrappers
// ---------------------------------------------------------------------------

/** The paginationSchemes map that lives under components. */
export type PaginationSchemesMap = Record<string, PaginationSchemeObject>;

/**
 * Minimal representation of an OAS operation relevant to pagination.
 * The client only needs parameter and body shape information for
 * auto-detection and for merging overrides.
 */
export interface OperationDescriptor {
  /** Query parameters declared on the operation. */
  queryParams?: string[];
  /** Top-level properties present in the request body schema. */
  bodyFields?: string[];
  /** Response body top-level property names (used for auto-detect). */
  responseBodyFields?: string[];
  /** Response header names (used for auto-detect). */
  responseHeaders?: string[];
  /**
   * Explicit pagination applications, if present in the OAS document.
   * An empty array opts the operation out of all schemes.
   * Absent = use auto-detection.
   */
  pagination?: PaginationApplicationObject[];
}

// ---------------------------------------------------------------------------
// Runtime pagination state (client-side)
// ---------------------------------------------------------------------------

/**
 * The resolved, effective scheme for a single operation — after overrides
 * have been merged and the scheme type has been determined.
 */
export interface EffectivePaginationScheme {
  schemeName: string;
  scheme: PaginationSchemeObject;
}

/** Parameters the client must inject into the next request. */
export interface PaginationRequestParams {
  queryParameters: Record<string, string | number>;
  bodyFields: Record<string, string | number>;
  headerFields: Record<string, string>;
}

/** Everything the client extracts from a server response. */
export interface PaginationResponseState {
  /** The raw token/cursor returned by the server (pageToken scheme). */
  nextPageToken: string | null;
  /** The next URL returned by the server (nextLink scheme). */
  nextLink: string | null;
  /** Current page number (pageNumber scheme). */
  currentPage: number | null;
  /** Total item count, when provided. */
  totalCount: number | null;
  /** Total page count, when provided. */
  totalPages: number | null;
  /** Page size as confirmed by the server, when provided. */
  pageSize: number | null;
  /** Whether there is definitely another page available. */
  hasNextPage: boolean;
}

/** A page of results together with pagination metadata. */
export interface Page<T> {
  items: T[];
  pagination: PaginationResponseState;
  /** The parameters that should be sent to fetch the NEXT page, if any. */
  nextPageParams: PaginationRequestParams | null;
}
