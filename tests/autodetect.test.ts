import { describe, it, expect } from "./harness.js";
import {
  schemeMatchesOperation,
  detectSchemes,
  mergeSchemeOverrides,
  resolveEffectiveSchemes,
} from "../src/autodetect.js";
import type {
  PaginationSchemeObject,
  PaginationSchemesMap,
  OperationDescriptor,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const pageNumberScheme: PaginationSchemeObject = {
  type: "pageNumber",
  request: {
    queryParameters: {
      page: { role: "page" },
      limit: { role: "pageSize" },
    },
  },
  response: {
    bodyFields: {
      total: { role: "totalCount" },
      totalPages: { role: "totalPages" },
    },
  },
};

const pageTokenScheme: PaginationSchemeObject = {
  type: "pageToken",
  request: {
    queryParameters: {
      pageToken: { role: "pageToken" },
    },
  },
  response: {
    bodyFields: {
      nextPageToken: { role: "nextPageToken" },
    },
  },
};

const nextLinkScheme: PaginationSchemeObject = {
  type: "nextLink",
  autoDetect: {
    matchQueryParams: false,
    matchBodyFields: false,
    matchHeaders: true,
    requireAll: false,
  },
  response: {
    headers: {
      Link: { role: "nextLink" },
    },
  },
};

const schemesMap: PaginationSchemesMap = {
  pageNumber: pageNumberScheme,
  pageToken: pageTokenScheme,
  nextLink: nextLinkScheme,
};

// ---------------------------------------------------------------------------
// schemeMatchesOperation — §6.3 Default rules
// ---------------------------------------------------------------------------

describe("schemeMatchesOperation — default auto-detection (§6.3)", () => {
  it("matches a pageNumber scheme when both query params are present", () => {
    const op: OperationDescriptor = {
      queryParams: ["page", "limit", "q"],
    };
    expect(schemeMatchesOperation(pageNumberScheme, op)).toBeTrue();
  });

  it("does not match when a required query param is missing", () => {
    const op: OperationDescriptor = {
      queryParams: ["page"], // missing "limit"
    };
    expect(schemeMatchesOperation(pageNumberScheme, op)).toBeFalse();
  });

  it("matches a pageToken scheme when pageToken param is present", () => {
    const op: OperationDescriptor = {
      queryParams: ["pageToken", "pageSize"],
    };
    expect(schemeMatchesOperation(pageTokenScheme, op)).toBeTrue();
  });

  it("does not match when operation has no query params at all", () => {
    const op: OperationDescriptor = { queryParams: [] };
    expect(schemeMatchesOperation(pageNumberScheme, op)).toBeFalse();
  });

  it("matches on body fields when scheme uses bodyFields", () => {
    const bodyScheme: PaginationSchemeObject = {
      type: "pageNumber",
      request: {
        bodyFields: {
          page: { role: "page" },
          size: { role: "pageSize" },
        },
      },
    };
    const op: OperationDescriptor = {
      bodyFields: ["page", "size", "query"],
    };
    expect(schemeMatchesOperation(bodyScheme, op)).toBeTrue();
  });

  it("does not match body fields when operation is missing a field", () => {
    const bodyScheme: PaginationSchemeObject = {
      type: "pageNumber",
      request: {
        bodyFields: {
          page: { role: "page" },
          size: { role: "pageSize" },
        },
      },
    };
    const op: OperationDescriptor = {
      bodyFields: ["page"], // missing "size"
    };
    expect(schemeMatchesOperation(bodyScheme, op)).toBeFalse();
  });

  it("returns false for autoDetect: false (§6.2)", () => {
    const scheme: PaginationSchemeObject = {
      type: "pageNumber",
      autoDetect: false,
      request: { queryParameters: { page: { role: "page" } } },
    };
    const op: OperationDescriptor = { queryParams: ["page"] };
    expect(schemeMatchesOperation(scheme, op)).toBeFalse();
  });

  it("returns false when scheme has no matchable dimensions", () => {
    // Scheme with only response fields, autoDetect defaults to matchQueryParams+matchBodyFields
    // but those maps are empty → no dimensions to match → no auto-detect
    const scheme: PaginationSchemeObject = {
      type: "pageToken",
      response: {
        bodyFields: { nextToken: { role: "nextPageToken" } },
      },
    };
    const op: OperationDescriptor = { queryParams: [] };
    expect(schemeMatchesOperation(scheme, op)).toBeFalse();
  });
});

// ---------------------------------------------------------------------------
// schemeMatchesOperation — §6.4 Custom AutoDetectObject
// ---------------------------------------------------------------------------

describe("schemeMatchesOperation — custom AutoDetectObject (§6.4)", () => {
  it("matches nextLink scheme on header presence", () => {
    const op: OperationDescriptor = {
      responseHeaders: ["Link", "Content-Type"],
    };
    expect(schemeMatchesOperation(nextLinkScheme, op)).toBeTrue();
  });

  it("does not match nextLink scheme when Link header absent", () => {
    const op: OperationDescriptor = {
      responseHeaders: ["Content-Type"],
    };
    expect(schemeMatchesOperation(nextLinkScheme, op)).toBeFalse();
  });

  it("requireAll:false — matches when ANY dimension passes", () => {
    const scheme: PaginationSchemeObject = {
      type: "pageNumber",
      autoDetect: {
        matchQueryParams: true,
        matchBodyFields: true,
        requireAll: false,
      },
      request: {
        queryParameters: { page: { role: "page" } },
        bodyFields: { size: { role: "pageSize" } },
      },
    };
    // Only queryParams match, not bodyFields
    const op: OperationDescriptor = {
      queryParams: ["page"],
      bodyFields: ["other"],
    };
    expect(schemeMatchesOperation(scheme, op)).toBeTrue();
  });

  it("requireAll:true — fails when ANY dimension fails", () => {
    const scheme: PaginationSchemeObject = {
      type: "pageNumber",
      autoDetect: {
        matchQueryParams: true,
        matchBodyFields: true,
        requireAll: true,
      },
      request: {
        queryParameters: { page: { role: "page" } },
        bodyFields: { size: { role: "pageSize" } },
      },
    };
    const op: OperationDescriptor = {
      queryParams: ["page"],
      bodyFields: ["other"], // size missing
    };
    expect(schemeMatchesOperation(scheme, op)).toBeFalse();
  });

  it("matchResponseFields:true — requires response body fields", () => {
    const scheme: PaginationSchemeObject = {
      type: "pageNumber",
      autoDetect: {
        matchQueryParams: true,
        matchResponseFields: true,
        requireAll: true,
      },
      request: {
        queryParameters: { page: { role: "page" } },
      },
      response: {
        bodyFields: {
          total: { role: "totalCount" },
        },
      },
    };
    const opWithResponseField: OperationDescriptor = {
      queryParams: ["page"],
      responseBodyFields: ["total", "items"],
    };
    const opWithoutResponseField: OperationDescriptor = {
      queryParams: ["page"],
      responseBodyFields: ["items"],
    };
    expect(schemeMatchesOperation(scheme, opWithResponseField)).toBeTrue();
    expect(schemeMatchesOperation(scheme, opWithoutResponseField)).toBeFalse();
  });
});

// ---------------------------------------------------------------------------
// detectSchemes
// ---------------------------------------------------------------------------

describe("detectSchemes", () => {
  it("detects pageNumber scheme from query params", () => {
    const op: OperationDescriptor = { queryParams: ["page", "limit"] };
    const detected = detectSchemes(schemesMap, op);
    expect(detected).toContain("pageNumber");
  });

  it("detects pageToken scheme from query params", () => {
    const op: OperationDescriptor = { queryParams: ["pageToken"] };
    const detected = detectSchemes(schemesMap, op);
    expect(detected).toContain("pageToken");
  });

  it("detects multiple schemes when params overlap", () => {
    // Both page+limit AND pageToken present
    const op: OperationDescriptor = {
      queryParams: ["page", "limit", "pageToken"],
      responseHeaders: ["Link"],
    };
    const detected = detectSchemes(schemesMap, op);
    expect(detected).toContain("pageNumber");
    expect(detected).toContain("pageToken");
    expect(detected).toContain("nextLink");
  });

  it("returns empty array when no schemes match", () => {
    const op: OperationDescriptor = { queryParams: ["q", "sort"] };
    const detected = detectSchemes(schemesMap, op);
    expect(detected).toHaveLength(0);
  });

  it("ignores schemes with autoDetect:false", () => {
    const mapWithDisabled: PaginationSchemesMap = {
      pageNumber: { ...pageNumberScheme, autoDetect: false },
    };
    const op: OperationDescriptor = { queryParams: ["page", "limit"] };
    expect(detectSchemes(mapWithDisabled, op)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// mergeSchemeOverrides (§5.2)
// ---------------------------------------------------------------------------

describe("mergeSchemeOverrides", () => {
  it("returns base unchanged when overrides is empty", () => {
    const merged = mergeSchemeOverrides(pageTokenScheme, {});
    expect(merged.type).toBe("pageToken");
    expect(merged.request?.queryParameters?.pageToken?.role).toBe("pageToken");
  });

  it("overrides the type field", () => {
    const merged = mergeSchemeOverrides(pageTokenScheme, { type: "nextLink" });
    expect(merged.type).toBe("nextLink");
  });

  it("deep-merges queryParameters — renamed field replaces old name", () => {
    const merged = mergeSchemeOverrides(pageTokenScheme, {
      request: {
        queryParameters: {
          continuation: { role: "pageToken" },
        },
      },
    });
    // New field present
    expect(merged.request?.queryParameters?.continuation?.role).toBe("pageToken");
    // Old field still present (merge, not replace)
    expect(merged.request?.queryParameters?.pageToken?.role).toBe("pageToken");
  });

  it("overrides a specific response body field role", () => {
    const merged = mergeSchemeOverrides(pageNumberScheme, {
      response: {
        bodyFields: {
          total: { role: "totalPages" }, // reinterpret "total" as totalPages
        },
      },
    });
    expect(merged.response?.bodyFields?.total?.role).toBe("totalPages");
    // Unaffected field remains
    expect(merged.response?.bodyFields?.totalPages?.role).toBe("totalPages");
  });

  it("overrides description", () => {
    const merged = mergeSchemeOverrides(pageNumberScheme, {
      description: "Custom description",
    });
    expect(merged.description).toBe("Custom description");
  });

  it("does not mutate the original scheme", () => {
    const originalType = pageTokenScheme.type;
    mergeSchemeOverrides(pageTokenScheme, { type: "nextLink" });
    expect(pageTokenScheme.type).toBe(originalType);
  });
});

// ---------------------------------------------------------------------------
// resolveEffectiveSchemes (§5.1)
// ---------------------------------------------------------------------------

describe("resolveEffectiveSchemes", () => {
  it("returns empty array for explicit empty pagination: []", () => {
    const op: OperationDescriptor = {
      queryParams: ["page", "limit"],
      pagination: [],
    };
    const result = resolveEffectiveSchemes(schemesMap, op);
    expect(result).toHaveLength(0);
  });

  it("uses explicit pagination annotations when present", () => {
    const op: OperationDescriptor = {
      queryParams: ["page", "limit"],
      pagination: [{ scheme: "pageNumber" }],
    };
    const result = resolveEffectiveSchemes(schemesMap, op);
    expect(result).toHaveLength(1);
    expect(result[0]!.schemeName).toBe("pageNumber");
  });

  it("applies overrides from the pagination application", () => {
    const op: OperationDescriptor = {
      pagination: [
        {
          scheme: "pageToken",
          overrides: {
            request: {
              queryParameters: {
                continuation: { role: "pageToken" },
              },
            },
          },
        },
      ],
    };
    const result = resolveEffectiveSchemes(schemesMap, op);
    expect(result).toHaveLength(1);
    // Override field present
    expect(
      result[0]!.scheme.request?.queryParameters?.continuation?.role,
    ).toBe("pageToken");
  });

  it("falls back to auto-detection when pagination field is absent", () => {
    const op: OperationDescriptor = {
      queryParams: ["page", "limit"],
    };
    const result = resolveEffectiveSchemes(schemesMap, op);
    expect(result.map((e) => e.schemeName)).toContain("pageNumber");
  });

  it("throws when referenced scheme does not exist in the map", () => {
    const op: OperationDescriptor = {
      pagination: [{ scheme: "nonExistent" }],
    };
    expect(() => resolveEffectiveSchemes(schemesMap, op)).toThrow("nonExistent");
  });

  it("resolves multiple explicit schemes", () => {
    const op: OperationDescriptor = {
      pagination: [
        { scheme: "pageNumber" },
        { scheme: "pageToken" },
      ],
    };
    const result = resolveEffectiveSchemes(schemesMap, op);
    expect(result).toHaveLength(2);
    expect(result[0]!.schemeName).toBe("pageNumber");
    expect(result[1]!.schemeName).toBe("pageToken");
  });
});
