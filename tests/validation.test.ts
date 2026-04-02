import { describe, it, expect } from "./harness.js";
import {
  validateScheme,
  validateSchemesMap,
  PaginationValidationError,
} from "../src/validation.js";
import type { PaginationSchemeObject } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validPageNumber: PaginationSchemeObject = {
  type: "pageNumber",
  request: {
    queryParameters: {
      page: { role: "page", schema: { type: "integer" } },
      limit: { role: "pageSize" },
    },
  },
  response: {
    bodyFields: {
      total: { role: "totalCount" },
      totalPages: { role: "totalPages" },
      currentPage: { role: "currentPage" },
    },
  },
};

const validPageToken: PaginationSchemeObject = {
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

const validNextLink: PaginationSchemeObject = {
  type: "nextLink",
  response: {
    headers: {
      Link: { role: "nextLink" },
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateScheme — valid schemes", () => {
  it("accepts a valid pageNumber scheme", () => {
    expect(() => validateScheme(validPageNumber, "pageNum")).not.toThrow();
  });

  it("accepts a valid pageToken scheme", () => {
    expect(() => validateScheme(validPageToken, "token")).not.toThrow();
  });

  it("accepts a valid nextLink scheme", () => {
    expect(() => validateScheme(validNextLink, "link")).not.toThrow();
  });

  it("accepts a scheme with only request (no response)", () => {
    const scheme: PaginationSchemeObject = {
      type: "pageNumber",
      request: { queryParameters: { page: { role: "page" } } },
    };
    expect(() => validateScheme(scheme, "x")).not.toThrow();
  });

  it("accepts a scheme with only response (no request)", () => {
    const scheme: PaginationSchemeObject = {
      type: "pageToken",
      response: { bodyFields: { next: { role: "nextPageToken" } } },
    };
    expect(() => validateScheme(scheme, "x")).not.toThrow();
  });

  it("accepts x- prefixed extension roles on request fields", () => {
    const scheme: PaginationSchemeObject = {
      type: "pageNumber",
      request: {
        queryParameters: {
          p: { role: "x-customPageRole" as never },
        },
      },
    };
    expect(() => validateScheme(scheme, "ext")).not.toThrow();
  });

  it("accepts x- prefixed extension roles on response fields", () => {
    const scheme: PaginationSchemeObject = {
      type: "pageNumber",
      response: {
        bodyFields: {
          meta: { role: "x-meta" as never },
        },
      },
    };
    expect(() => validateScheme(scheme, "ext")).not.toThrow();
  });
});

describe("validateScheme — §9.1 violations", () => {
  it("throws for an invalid type", () => {
    const bad = { type: "offset" as never, request: { queryParameters: {} } };
    expect(() => validateScheme(bad, "bad")).toThrow("Invalid type");
  });

  it("throws for missing both request and response", () => {
    const bad: PaginationSchemeObject = { type: "pageNumber" } as never;
    expect(() => validateScheme(bad, "empty")).toThrow("at least one");
  });

  it("throws for unknown request field role", () => {
    const bad: PaginationSchemeObject = {
      type: "pageNumber",
      request: {
        queryParameters: {
          p: { role: "badRole" as never },
        },
      },
    };
    expect(() => validateScheme(bad, "bad")).toThrow("Unknown request role");
  });

  it("throws for unknown response body field role", () => {
    const bad: PaginationSchemeObject = {
      type: "pageToken",
      response: {
        bodyFields: {
          x: { role: "unknownResponseRole" as never },
        },
      },
    };
    expect(() => validateScheme(bad, "bad")).toThrow("Unknown response role");
  });

  it("throws for unknown response header role", () => {
    const bad: PaginationSchemeObject = {
      type: "nextLink",
      response: {
        headers: {
          "X-Custom": { role: "badHeaderRole" as never },
        },
      },
    };
    expect(() => validateScheme(bad, "bad")).toThrow("Unknown response role");
  });

  it("attaches the correct path to the error", () => {
    const bad: PaginationSchemeObject = { type: "pageNumber" } as never;
    let caught: PaginationValidationError | null = null;
    try {
      validateScheme(bad, "myScheme");
    } catch (e) {
      caught = e as PaginationValidationError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.path).toBe("paginationSchemes.myScheme");
  });

  it("throws PaginationValidationError (not generic Error)", () => {
    const bad: PaginationSchemeObject = { type: "pageNumber" } as never;
    let caught: unknown = null;
    try {
      validateScheme(bad, "x");
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof PaginationValidationError).toBeTrue();
  });
});

describe("validateSchemesMap", () => {
  it("accepts a valid map of multiple schemes", () => {
    expect(() =>
      validateSchemesMap({
        pageNum: validPageNumber,
        token: validPageToken,
        link: validNextLink,
      }),
    ).not.toThrow();
  });

  it("throws on the first invalid scheme in the map", () => {
    expect(() =>
      validateSchemesMap({
        good: validPageNumber,
        bad: { type: "pageNumber" } as never,
      }),
    ).toThrow();
  });

  it("accepts an empty map", () => {
    expect(() => validateSchemesMap({})).not.toThrow();
  });
});

describe("validateScheme — request bodyFields and headerFields", () => {
  it("validates roles in request bodyFields", () => {
    const bad: PaginationSchemeObject = {
      type: "pageNumber",
      request: {
        bodyFields: {
          pg: { role: "badRole" as never },
        },
      },
    };
    expect(() => validateScheme(bad, "x")).toThrow("Unknown request role");
  });

  it("accepts valid roles in request bodyFields", () => {
    const scheme: PaginationSchemeObject = {
      type: "pageNumber",
      request: {
        bodyFields: {
          pg: { role: "page" },
          sz: { role: "pageSize" },
        },
      },
    };
    expect(() => validateScheme(scheme, "x")).not.toThrow();
  });

  it("validates roles in request headerFields", () => {
    const bad: PaginationSchemeObject = {
      type: "pageToken",
      request: {
        headerFields: {
          "X-Token": { role: "badRole" as never },
        },
      },
    };
    expect(() => validateScheme(bad, "x")).toThrow("Unknown request role");
  });

  it("accepts valid roles in request headerFields", () => {
    const scheme: PaginationSchemeObject = {
      type: "pageToken",
      request: {
        headerFields: {
          "X-Token": { role: "pageToken" },
        },
      },
    };
    expect(() => validateScheme(scheme, "x")).not.toThrow();
  });
});
