/**
 * @openapi-pagination/client
 *
 * Public API surface of the OpenAPI Pagination Extension client library.
 */

// Types
export type {
  SchemeType,
  RequestRole,
  ResponseRole,
  RequestFieldObject,
  RequestPaginationFieldsObject,
  ResponseFieldObject,
  ResponsePaginationFieldsObject,
  AutoDetectObject,
  PaginationSchemeObject,
  PaginationApplicationObject,
  PaginationSchemesMap,
  OperationDescriptor,
  EffectivePaginationScheme,
  PaginationRequestParams,
  PaginationResponseState,
  Page,
} from "./types.js";

// Validation
export { validateScheme, validateSchemesMap, PaginationValidationError } from "./validation.js";

// Auto-detection & resolution
export {
  schemeMatchesOperation,
  detectSchemes,
  mergeSchemeOverrides,
  resolveEffectiveSchemes,
} from "./autodetect.js";

// Request building
export {
  buildFirstPageParams,
  buildNextPageParams,
  applyParamsToRequest,
} from "./request-builder.js";
export type { BuildFirstPageOptions, BuildNextPageOptions } from "./request-builder.js";

// Response parsing
export { parseResponse, parseLinkHeader, buildNextFromState } from "./response-parser.js";

// High-level client
export { PaginatedClient } from "./client.js";
export type { PaginatedClientOptions, FetchPageOptions, Fetcher, FetcherInit } from "./client.js";
