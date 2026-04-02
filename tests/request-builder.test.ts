import { describe, it, expect } from "./harness.js";
import {
  buildFirstPageParams,
  buildNextPageParams,
  applyParamsToRequest,
} from "../src/request-builder.js";
import type { PaginationSchemeObject } from "../src/types.js";

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
};

const pageTokenScheme: PaginationSchemeObject = {
  type: "pageToken",
  request: {
    queryParameters: {
      pageToken: { role: "pageToken" },
      pageSize: { role: "pageSize" },
    },
  },
};

const cursorScheme: PaginationSchemeObject = {
  type: "pageToken",
  request: {
    queryParameters: {
      cursor: { role: "cursor" }, // synonym for pageToken
      pageSize: { role: "pageSize" },
    },
  },
};

const nextLinkScheme: PaginationSchemeObject = {
  type: "nextLink",
  request: {
    queryParameters: {
      per_page: { role: "pageSize" },
    },
  },
};

const bodyFieldScheme: PaginationSchemeObject = {
  type: "pageNumber",
  request: {
    bodyFields: {
      page: { role: "page" },
      size: { role: "pageSize" },
    },
  },
};

// ---------------------------------------------------------------------------
// buildFirstPageParams
// ---------------------------------------------------------------------------

describe("buildFirstPageParams — pageNumber scheme", () => {
  it("sets page to 1 on the first request", () => {
    const params = buildFirstPageParams(pageNumberScheme);
    expect(params.queryParameters["page"]).toBe(1);
  });

  it("includes pageSize when provided", () => {
    const params = buildFirstPageParams(pageNumberScheme, { pageSize: 50 });
    expect(params.queryParameters["limit"]).toBe(50);
  });

  it("does not include pageSize key when not provided", () => {
    const params = buildFirstPageParams(pageNumberScheme);
    expect(params.queryParameters["limit"]).toBe(undefined);
  });

  it("returns empty bodyFields and headerFields", () => {
    const params = buildFirstPageParams(pageNumberScheme);
    expect(Object.keys(params.bodyFields)).toHaveLength(0);
    expect(Object.keys(params.headerFields)).toHaveLength(0);
  });
});

describe("buildFirstPageParams — pageToken scheme", () => {
  it("does not include a token on the first page", () => {
    const params = buildFirstPageParams(pageTokenScheme);
    expect(params.queryParameters["pageToken"]).toBe(undefined);
  });

  it("includes pageSize when provided", () => {
    const params = buildFirstPageParams(pageTokenScheme, { pageSize: 100 });
    expect(params.queryParameters["pageSize"]).toBe(100);
  });
});

describe("buildFirstPageParams — nextLink scheme", () => {
  it("includes pageSize on first page when provided", () => {
    const params = buildFirstPageParams(nextLinkScheme, { pageSize: 30 });
    expect(params.queryParameters["per_page"]).toBe(30);
  });

  it("returns empty params without pageSize", () => {
    const params = buildFirstPageParams(nextLinkScheme);
    expect(Object.keys(params.queryParameters)).toHaveLength(0);
  });
});

describe("buildFirstPageParams — body field scheme", () => {
  it("places page in bodyFields, not queryParameters", () => {
    const params = buildFirstPageParams(bodyFieldScheme);
    expect(params.bodyFields["page"]).toBe(1);
    expect(params.queryParameters["page"]).toBe(undefined);
  });

  it("places pageSize in bodyFields", () => {
    const params = buildFirstPageParams(bodyFieldScheme, { pageSize: 25 });
    expect(params.bodyFields["size"]).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// buildNextPageParams
// ---------------------------------------------------------------------------

describe("buildNextPageParams — pageNumber scheme", () => {
  it("increments the page number", () => {
    const params = buildNextPageParams(pageNumberScheme, {
      previousToken: null,
      previousPage: 3,
    });
    expect(params?.queryParameters["page"]).toBe(4);
  });

  it("returns null when previousPage is null", () => {
    const params = buildNextPageParams(pageNumberScheme, {
      previousToken: null,
      previousPage: null,
    });
    expect(params).toBeNull();
  });

  it("preserves pageSize on next page", () => {
    const params = buildNextPageParams(pageNumberScheme, {
      previousToken: null,
      previousPage: 1,
      pageSize: 20,
    });
    expect(params?.queryParameters["limit"]).toBe(20);
  });
});

describe("buildNextPageParams — pageToken scheme", () => {
  it("injects the token from the previous response", () => {
    const params = buildNextPageParams(pageTokenScheme, {
      previousToken: "abc123",
      previousPage: null,
    });
    expect(params?.queryParameters["pageToken"]).toBe("abc123");
  });

  it("returns null when token is null (final page signal)", () => {
    const params = buildNextPageParams(pageTokenScheme, {
      previousToken: null,
      previousPage: null,
    });
    expect(params).toBeNull();
  });

  it("uses cursor field when role is cursor (synonym)", () => {
    const params = buildNextPageParams(cursorScheme, {
      previousToken: "cursor-xyz",
      previousPage: null,
    });
    expect(params?.queryParameters["cursor"]).toBe("cursor-xyz");
  });
});

describe("buildNextPageParams — nextLink scheme", () => {
  it("returns empty params (caller uses the link URL directly)", () => {
    const params = buildNextPageParams(nextLinkScheme, {
      previousToken: null,
      previousPage: null,
    });
    expect(params).not.toBeNull();
    expect(Object.keys(params!.queryParameters)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyParamsToRequest
// ---------------------------------------------------------------------------

describe("applyParamsToRequest", () => {
  it("appends query parameters to the URL", () => {
    const { url } = applyParamsToRequest(
      "https://api.example.com/items",
      {
        queryParameters: { page: 2, limit: 20 },
        bodyFields: {},
        headerFields: {},
      },
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("2");
    expect(parsed.searchParams.get("limit")).toBe("20");
  });

  it("preserves existing query parameters in the URL", () => {
    const { url } = applyParamsToRequest(
      "https://api.example.com/search?q=cats",
      {
        queryParameters: { page: 1 },
        bodyFields: {},
        headerFields: {},
      },
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("cats");
    expect(parsed.searchParams.get("page")).toBe("1");
  });

  it("merges header fields into supplied headers", () => {
    const { headers } = applyParamsToRequest(
      "https://api.example.com/items",
      {
        queryParameters: {},
        bodyFields: {},
        headerFields: { "X-Pagination-Token": "tok" },
      },
      { Authorization: "Bearer secret" },
    );
    expect(headers["X-Pagination-Token"]).toBe("tok");
    expect(headers["Authorization"]).toBe("Bearer secret");
  });

  it("returns bodyFields separate from query params", () => {
    const { bodyFields } = applyParamsToRequest(
      "https://api.example.com/items",
      {
        queryParameters: {},
        bodyFields: { page: 2, size: 10 },
        headerFields: {},
      },
    );
    expect(bodyFields["page"]).toBe(2);
    expect(bodyFields["size"]).toBe(10);
  });

  it("handles base URLs with trailing slashes", () => {
    const { url } = applyParamsToRequest(
      "https://api.example.com/items/",
      { queryParameters: { page: 1 }, bodyFields: {}, headerFields: {} },
    );
    expect(url.startsWith("https://api.example.com/items/")).toBeTrue();
  });
});
