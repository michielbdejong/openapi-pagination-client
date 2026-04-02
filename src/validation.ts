/**
 * Spec validation (Section 9.1 — Document Conformance).
 *
 * Validates PaginationSchemeObjects and their maps against the normative
 * requirements of the specification. Throws PaginationValidationError for
 * any violation.
 */

import type {
  PaginationSchemeObject,
  PaginationSchemesMap,
  RequestFieldObject,
  ResponseFieldObject,
} from "./types.js";

const VALID_TYPES = new Set(["pageNumber", "pageToken", "nextLink"]);

const VALID_REQUEST_ROLES = new Set([
  "page", "pageSize", "offset", "pageToken", "cursor",
]);

const VALID_RESPONSE_ROLES = new Set([
  "nextPageToken", "nextCursor", "nextLink",
  "totalCount", "totalPages", "pageSize", "currentPage",
]);

export class PaginationValidationError extends Error {
  constructor(message: string, public readonly path: string) {
    super(`[${path}] ${message}`);
    this.name = "PaginationValidationError";
  }
}

function validateRequestField(
  field: RequestFieldObject,
  path: string,
): void {
  if (field.role !== undefined) {
    if (!VALID_REQUEST_ROLES.has(field.role) && !field.role.startsWith("x-")) {
      throw new PaginationValidationError(
        `Unknown request role "${field.role}". ` +
          `Must be one of: ${[...VALID_REQUEST_ROLES].join(", ")}, or x-prefixed.`,
        path + ".role",
      );
    }
  }
}

function validateResponseField(
  field: ResponseFieldObject,
  path: string,
): void {
  if (field.role !== undefined) {
    if (!VALID_RESPONSE_ROLES.has(field.role) && !field.role.startsWith("x-")) {
      throw new PaginationValidationError(
        `Unknown response role "${field.role}". ` +
          `Must be one of: ${[...VALID_RESPONSE_ROLES].join(", ")}, or x-prefixed.`,
        path + ".role",
      );
    }
  }
}

/**
 * Validates a single PaginationSchemeObject.
 * Throws PaginationValidationError on any spec violation.
 */
export function validateScheme(
  scheme: PaginationSchemeObject,
  name: string,
): void {
  const path = `paginationSchemes.${name}`;

  // §9.1 — type MUST be valid
  if (!VALID_TYPES.has(scheme.type)) {
    throw new PaginationValidationError(
      `Invalid type "${scheme.type}". Must be one of: pageNumber, pageToken, nextLink.`,
      path + ".type",
    );
  }

  // §4.1 NOTE — at least one of request/response MUST be present
  if (!scheme.request && !scheme.response) {
    throw new PaginationValidationError(
      "Scheme must define at least one of 'request' or 'response'.",
      path,
    );
  }

  // Validate request field roles
  if (scheme.request) {
    for (const [paramName, field] of Object.entries(
      scheme.request.queryParameters ?? {},
    )) {
      validateRequestField(field, `${path}.request.queryParameters.${paramName}`);
    }
    for (const [paramName, field] of Object.entries(
      scheme.request.bodyFields ?? {},
    )) {
      validateRequestField(field, `${path}.request.bodyFields.${paramName}`);
    }
    for (const [paramName, field] of Object.entries(
      scheme.request.headerFields ?? {},
    )) {
      validateRequestField(field, `${path}.request.headerFields.${paramName}`);
    }
  }

  // Validate response field roles
  if (scheme.response) {
    for (const [fieldName, field] of Object.entries(
      scheme.response.bodyFields ?? {},
    )) {
      validateResponseField(field, `${path}.response.bodyFields.${fieldName}`);
    }
    for (const [headerName, field] of Object.entries(
      scheme.response.headers ?? {},
    )) {
      validateResponseField(field, `${path}.response.headers.${headerName}`);
    }
  }
}

/**
 * Validates an entire paginationSchemes map.
 * Throws on the first violation found.
 */
export function validateSchemesMap(map: PaginationSchemesMap): void {
  for (const [name, scheme] of Object.entries(map)) {
    validateScheme(scheme, name);
  }
}
