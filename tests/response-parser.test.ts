import { describe, it, expect } from "./harness.js";
import {
  parseResponse,
  parseLinkHeader,
  buildNextFromState,
} from "../src/response-parser.js";
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
  response: {
    bodyFields: {
      total: { role: "totalCount" },
      totalPages: { role: "totalPages" },
      currentPage: { role: "currentPage" },
      pageSize: { role: "pageSize" },
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

const cursorScheme: PaginationSchemeObject = {
  type: "pageToken",
  response: {
    bodyFields: {
      nextCursor: { role: "nextCursor" },
    },
  },
};

const linkHeaderScheme: PaginationSchemeObject = {
  type: "nextLink",
  response: {
    headers: {
      Link: { role: "nextLink" },
    },
  },
};

const linkBodyScheme: PaginationSchemeObject = {
  type: "nextLink",
  response: {
    bodyFields: {
      next: { role: "nextLink" },
    },
  },
};

// ---------------------------------------------------------------------------
// parseLinkHeader
// ---------------------------------------------------------------------------

describe("parseLinkHeader", () => {
  it("extracts a simple rel=next URL", () => {
    const url = parseLinkHeader(
      '<https://api.example.com/items?page=2>; rel="next"',
    );
    expect(url).toBe("https://api.example.com/items?page=2");
  });

  it("extracts rel=next when multiple rels are present", () => {
    const url = parseLinkHeader(
      '<https://api.example.com/items?page=1>; rel="prev", ' +
        '<https://api.example.com/items?page=3>; rel="next", ' +
        '<https://api.example.com/items?page=10>; rel="last"',
    );
    expect(url).toBe("https://api.example.com/items?page=3");
  });

  it("returns null when no rel=next is present", () => {
    const url = parseLinkHeader(
      '<https://api.example.com/items?page=1>; rel="prev"',
    );
    expect(url).toBeNull();
  });

  it("handles rel without quotes", () => {
    const url = parseLinkHeader(
      "<https://api.example.com/items?page=2>; rel=next",
    );
    expect(url).toBe("https://api.example.com/items?page=2");
  });

  it("returns null for empty string", () => {
    expect(parseLinkHeader("")).toBeNull();
  });

  it("is case-insensitive for rel value", () => {
    const url = parseLinkHeader(
      '<https://api.example.com/items?page=2>; rel="Next"',
    );
    expect(url).toBe("https://api.example.com/items?page=2");
  });
});

// ---------------------------------------------------------------------------
// parseResponse — pageNumber scheme
// ---------------------------------------------------------------------------

describe("parseResponse — pageNumber scheme", () => {
  it("extracts currentPage, totalCount, totalPages, pageSize", () => {
    const state = parseResponse(pageNumberScheme, {
      items: [],
      currentPage: 2,
      total: 150,
      totalPages: 8,
      pageSize: 20,
    });
    expect(state.currentPage).toBe(2);
    expect(state.totalCount).toBe(150);
    expect(state.totalPages).toBe(8);
    expect(state.pageSize).toBe(20);
  });

  it("hasNextPage is true when currentPage < totalPages", () => {
    const state = parseResponse(pageNumberScheme, {
      currentPage: 3,
      totalPages: 8,
      total: 150,
    });
    expect(state.hasNextPage).toBeTrue();
  });

  it("hasNextPage is false when currentPage === totalPages", () => {
    const state = parseResponse(pageNumberScheme, {
      currentPage: 8,
      totalPages: 8,
      total: 150,
    });
    expect(state.hasNextPage).toBeFalse();
  });

  it("derives hasNextPage from totalCount + pageSize when totalPages absent", () => {
    const state = parseResponse(pageNumberScheme, {
      currentPage: 1,
      total: 50,   // totalCount
      pageSize: 20,
    });
    // page 1 * 20 = 20 items fetched, 50 total → more pages
    expect(state.hasNextPage).toBeTrue();
  });

  it("hasNextPage false when all items fetched via count+size", () => {
    const state = parseResponse(pageNumberScheme, {
      currentPage: 3,
      total: 50,
      pageSize: 20,
    });
    // page 3 * 20 = 60 >= 50
    expect(state.hasNextPage).toBeFalse();
  });

  it("nextPageToken is null for pageNumber scheme", () => {
    const state = parseResponse(pageNumberScheme, {
      currentPage: 1,
      totalPages: 3,
    });
    expect(state.nextPageToken).toBeNull();
  });

  it("ignores absent response fields gracefully", () => {
    const state = parseResponse(pageNumberScheme, {});
    expect(state.currentPage).toBeNull();
    expect(state.totalCount).toBeNull();
    expect(state.hasNextPage).toBeFalse();
  });
});

// ---------------------------------------------------------------------------
// parseResponse — pageToken scheme
// ---------------------------------------------------------------------------

describe("parseResponse — pageToken scheme", () => {
  it("extracts nextPageToken from body", () => {
    const state = parseResponse(pageTokenScheme, {
      items: [],
      nextPageToken: "tok_abc",
    });
    expect(state.nextPageToken).toBe("tok_abc");
    expect(state.hasNextPage).toBeTrue();
  });

  it("hasNextPage is false when nextPageToken is null", () => {
    const state = parseResponse(pageTokenScheme, {
      items: [],
      nextPageToken: null,
    });
    expect(state.nextPageToken).toBeNull();
    expect(state.hasNextPage).toBeFalse();
  });

  it("hasNextPage is false when nextPageToken is absent", () => {
    const state = parseResponse(pageTokenScheme, { items: [] });
    expect(state.hasNextPage).toBeFalse();
  });

  it("handles nextCursor role (synonym for nextPageToken)", () => {
    const state = parseResponse(cursorScheme, {
      nextCursor: "cursor-xyz",
    });
    // nextCursor is mapped to nextPageToken slot
    expect(state.nextPageToken).toBe("cursor-xyz");
    expect(state.hasNextPage).toBeTrue();
  });

  it("empty string token is treated as null", () => {
    const state = parseResponse(pageTokenScheme, { nextPageToken: "" });
    expect(state.nextPageToken).toBeNull();
    expect(state.hasNextPage).toBeFalse();
  });
});

// ---------------------------------------------------------------------------
// parseResponse — nextLink scheme (header)
// ---------------------------------------------------------------------------

describe("parseResponse — nextLink scheme via Link header", () => {
  it("extracts next URL from RFC 8288 Link header", () => {
    const state = parseResponse(
      linkHeaderScheme,
      {},
      { Link: '<https://api.example.com/items?page=2>; rel="next"' },
    );
    expect(state.nextLink).toBe("https://api.example.com/items?page=2");
    expect(state.hasNextPage).toBeTrue();
  });

  it("hasNextPage is false when Link header has no rel=next", () => {
    const state = parseResponse(
      linkHeaderScheme,
      {},
      { Link: '<https://api.example.com/items?page=1>; rel="prev"' },
    );
    expect(state.nextLink).toBeNull();
    expect(state.hasNextPage).toBeFalse();
  });

  it("hasNextPage is false when Link header is absent", () => {
    const state = parseResponse(linkHeaderScheme, {}, {});
    expect(state.hasNextPage).toBeFalse();
  });

  it("is case-insensitive on header name lookup", () => {
    const state = parseResponse(
      linkHeaderScheme,
      {},
      { link: '<https://api.example.com/items?page=2>; rel="next"' },
    );
    expect(state.nextLink).toBe("https://api.example.com/items?page=2");
  });
});

// ---------------------------------------------------------------------------
// parseResponse — nextLink scheme (body field)
// ---------------------------------------------------------------------------

describe("parseResponse — nextLink scheme via body field", () => {
  it("extracts nextLink from body field", () => {
    const state = parseResponse(linkBodyScheme, {
      items: [],
      next: "https://api.example.com/items?cursor=xyz",
    });
    expect(state.nextLink).toBe("https://api.example.com/items?cursor=xyz");
    expect(state.hasNextPage).toBeTrue();
  });

  it("hasNextPage false when next is null in body", () => {
    const state = parseResponse(linkBodyScheme, { next: null });
    expect(state.hasNextPage).toBeFalse();
  });
});

// ---------------------------------------------------------------------------
// buildNextFromState
// ---------------------------------------------------------------------------

describe("buildNextFromState", () => {
  it("returns null when hasNextPage is false", () => {
    const state = {
      nextPageToken: null,
      nextLink: null,
      currentPage: 5,
      totalCount: 80,
      totalPages: 5,
      pageSize: 20,
      hasNextPage: false,
    };
    expect(buildNextFromState(pageNumberScheme, state)).toBeNull();
  });

  it("builds correct params for next pageNumber page", () => {
    const state = {
      nextPageToken: null,
      nextLink: null,
      currentPage: 2,
      totalCount: 100,
      totalPages: 5,
      pageSize: 20,
      hasNextPage: true,
    };
    const params = buildNextFromState(pageNumberScheme, state);
    expect(params?.queryParameters["page"]).toBe(3);
  });

  it("injects token for next pageToken page", () => {
    const state = {
      nextPageToken: "tok_next",
      nextLink: null,
      currentPage: null,
      totalCount: null,
      totalPages: null,
      pageSize: null,
      hasNextPage: true,
    };
    const params = buildNextFromState(pageTokenScheme, state);
    expect(params?.queryParameters["pageToken"]).toBe("tok_next");
  });

  it("returns empty params for nextLink (caller uses URL)", () => {
    const state = {
      nextPageToken: null,
      nextLink: "https://api.example.com/items?page=2",
      currentPage: null,
      totalCount: null,
      totalPages: null,
      pageSize: null,
      hasNextPage: true,
    };
    const params = buildNextFromState(linkHeaderScheme, state);
    expect(params).not.toBeNull();
    expect(Object.keys(params!.queryParameters)).toHaveLength(0);
  });
});
