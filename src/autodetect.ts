/**
 * Auto-detection engine (Specification Section 6).
 *
 * Determines which pagination schemes apply to an operation when no explicit
 * `pagination` annotation is present on that operation.
 *
 * Section 6.3 — Default auto-detection rules:
 *   A scheme is inferred to apply if and only if:
 *   1. The operation has no explicit pagination field (or no entry for this scheme).
 *   2. For every queryParameter in the scheme's request.queryParameters, the
 *      operation declares a query param with an identical name.
 *   3. For every bodyField in the scheme's request.bodyFields, the operation's
 *      request body schema includes a property with an identical name.
 *   (Response fields are NOT considered by default.)
 *
 * Section 6.4 — Custom Auto-Detect Object rules:
 *   matchQueryParams, matchBodyFields, matchResponseFields, matchHeaders,
 *   requireAll — give fine-grained control over which dimensions are matched
 *   and whether ALL or ANY must pass.
 */

import type {
  AutoDetectObject,
  OperationDescriptor,
  PaginationSchemeObject,
  PaginationSchemesMap,
  EffectivePaginationScheme,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the resolved AutoDetectObject for a scheme, normalising the
 * boolean shorthand into a full object.
 * Returns null if auto-detection is disabled (autoDetect === false).
 */
function resolveAutoDetect(
  scheme: PaginationSchemeObject,
): AutoDetectObject | null {
  const ad = scheme.autoDetect;

  // Default is true when the field is absent
  if (ad === undefined || ad === true) {
    return {
      matchQueryParams: true,
      matchBodyFields: true,
      matchResponseFields: false,
      matchHeaders: false,
      requireAll: true,
    };
  }

  if (ad === false) {
    return null;
  }

  // AutoDetectObject — fill in defaults for any omitted fields
  return {
    matchQueryParams: ad.matchQueryParams ?? true,
    matchBodyFields: ad.matchBodyFields ?? true,
    matchResponseFields: ad.matchResponseFields ?? false,
    matchHeaders: ad.matchHeaders ?? false,
    requireAll: ad.requireAll ?? true,
  };
}

/**
 * Checks whether a single dimension (e.g. queryParameters) is satisfied.
 * Returns true when every key in the scheme's map is present in the
 * operation's declared list.
 */
function dimensionMatches(
  schemeKeys: string[],
  operationKeys: string[],
): boolean {
  if (schemeKeys.length === 0) {
    // Nothing to match — this dimension vacuously passes
    return true;
  }
  const opSet = new Set(operationKeys);
  return schemeKeys.every((k) => opSet.has(k));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Given a single scheme and an operation descriptor, returns true if the
 * scheme should be auto-detected as applying to that operation.
 */
export function schemeMatchesOperation(
  scheme: PaginationSchemeObject,
  operation: OperationDescriptor,
): boolean {
  const ad = resolveAutoDetect(scheme);

  // autoDetect: false — never matches via auto-detection
  if (ad === null) return false;

  // Collect results per enabled dimension
  const results: boolean[] = [];

  if (ad.matchQueryParams) {
    const schemeParams = Object.keys(scheme.request?.queryParameters ?? {});
    // Vacuously true when the scheme defines no query params (nothing to match)
    // but skip this dimension entirely so it does not influence requireAll logic
    if (schemeParams.length > 0) {
      results.push(
        dimensionMatches(schemeParams, operation.queryParams ?? []),
      );
    }
  }

  if (ad.matchBodyFields) {
    const schemeFields = Object.keys(scheme.request?.bodyFields ?? {});
    if (schemeFields.length > 0) {
      results.push(
        dimensionMatches(schemeFields, operation.bodyFields ?? []),
      );
    }
  }

  if (ad.matchResponseFields) {
    const schemeFields = Object.keys(scheme.response?.bodyFields ?? {});
    if (schemeFields.length > 0) {
      results.push(
        dimensionMatches(schemeFields, operation.responseBodyFields ?? []),
      );
    }
  }

  if (ad.matchHeaders) {
    const schemeHeaders = Object.keys(scheme.response?.headers ?? {});
    if (schemeHeaders.length > 0) {
      results.push(
        dimensionMatches(schemeHeaders, operation.responseHeaders ?? []),
      );
    }
  }

  // If no dimensions were active and had something to match, the scheme
  // cannot meaningfully be inferred — do not auto-detect it.
  if (results.length === 0) return false;

  return ad.requireAll
    ? results.every(Boolean)
    : results.some(Boolean);
}

/**
 * Returns the list of scheme names that auto-detect as applying to the
 * given operation. Schemes with autoDetect: false are never included.
 */
export function detectSchemes(
  schemesMap: PaginationSchemesMap,
  operation: OperationDescriptor,
): string[] {
  return Object.entries(schemesMap)
    .filter(([, scheme]) => schemeMatchesOperation(scheme, operation))
    .map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Override merging (Section 5.2)
// ---------------------------------------------------------------------------

/**
 * Deep-merges the overrides partial object onto the base scheme.
 * Fields present in overrides replace those in base; nested objects
 * are merged recursively. Arrays are replaced entirely (not concatenated).
 */
export function mergeSchemeOverrides(
  base: PaginationSchemeObject,
  overrides: Partial<PaginationSchemeObject>,
): PaginationSchemeObject {
  const merged: PaginationSchemeObject = { ...base };

  if (overrides.type !== undefined) merged.type = overrides.type;
  if (overrides.description !== undefined) merged.description = overrides.description;
  if (overrides.autoDetect !== undefined) merged.autoDetect = overrides.autoDetect;

  if (overrides.request !== undefined) {
    merged.request = {
      ...base.request,
      ...overrides.request,
      queryParameters: {
        ...base.request?.queryParameters,
        ...overrides.request.queryParameters,
      },
      bodyFields: {
        ...base.request?.bodyFields,
        ...overrides.request.bodyFields,
      },
      headerFields: {
        ...base.request?.headerFields,
        ...overrides.request.headerFields,
      },
    };
  }

  if (overrides.response !== undefined) {
    merged.response = {
      ...base.response,
      ...overrides.response,
      bodyFields: {
        ...base.response?.bodyFields,
        ...overrides.response.bodyFields,
      },
      headers: {
        ...base.response?.headers,
        ...overrides.response.headers,
      },
    };
  }

  return merged;
}

/**
 * Resolves the effective schemes for an operation.
 *
 * Algorithm:
 *  - If operation.pagination is an empty array → no schemes (explicit opt-out).
 *  - If operation.pagination has entries → use those, applying any overrides.
 *  - If operation.pagination is absent → auto-detect from schemesMap.
 */
export function resolveEffectiveSchemes(
  schemesMap: PaginationSchemesMap,
  operation: OperationDescriptor,
): EffectivePaginationScheme[] {
  // Explicit empty array = opt-out
  if (operation.pagination !== undefined && operation.pagination.length === 0) {
    return [];
  }

  // Explicit annotations
  if (operation.pagination !== undefined && operation.pagination.length > 0) {
    return operation.pagination.map((app) => {
      const base = schemesMap[app.scheme];
      if (!base) {
        throw new Error(
          `Pagination scheme "${app.scheme}" is referenced on an operation ` +
            `but is not defined in components.paginationSchemes.`,
        );
      }
      const scheme = app.overrides
        ? mergeSchemeOverrides(base, app.overrides)
        : base;
      return { schemeName: app.scheme, scheme };
    });
  }

  // Auto-detect
  return detectSchemes(schemesMap, operation).map((name) => ({
    schemeName: name,
    scheme: schemesMap[name]!,
  }));
}
