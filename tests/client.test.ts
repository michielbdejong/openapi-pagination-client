import { describe, it, expect } from "./harness.js";
import { PaginatedClient } from "../src/client.js";
import type {
  PaginationSchemesMap,
  PaginationRequestParams,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Shared schemes
// ---------------------------------------------------------------------------

const schemes: PaginationSchemesMap = {
  pageNumber: {
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
      },
    },
  },

  pageToken: {
    type: "pageToken",
    request: {
      queryParameters: {
        pageToken: { role: "pageToken" },
        pageSize: { role: "pageSize" },
      },
    },
    response: {
      bodyFields: {
        nextPageToken: { role: "nextPageToken" },
      },
    },
  },

  nextLink: {
    type: "nextLink",
    request: {
      queryParameters: {
        per_page: { role: "pageSize" },
      },
    },
    response: {
      headers: {
        Link: { role: "nextLink" },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Mock fetcher factory
// ---------------------------------------------------------------------------

interface MockPage {
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Creates a Fetcher that serves pages from a predefined sequence.
 * Records every call for assertion.
 */
function makeMockFetcher(pages: MockPage[]) {
  const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  let callIndex = 0;

  const fetcher = async (
    url: string,
    init?: { headers?: Record<string, string> },
  ) => {
    calls.push({ url, headers: init?.headers });
    const page = pages[callIndex++];
    if (!page) throw new Error(`Unexpected fetch call #${callIndex} to ${url}`);
    return { body: page.body, headers: page.headers ?? {} };
  };

  return { fetcher, calls };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(id: number) {
  return { id, name: `Product ${id}` };
}

// ---------------------------------------------------------------------------
// Construction & validation
// ---------------------------------------------------------------------------

describe("PaginatedClient — construction", () => {
  it("constructs without error for valid schemes", () => {
    expect(
      () =>
        new PaginatedClient({
          baseUrl: "https://api.example.com",
          schemes,
          fetcher: async () => ({ body: {}, headers: {} }),
        }),
    ).not.toThrow();
  });

  it("throws on construction when schemes are invalid (validate: true)", () => {
    expect(
      () =>
        new PaginatedClient({
          baseUrl: "https://api.example.com",
          schemes: {
            bad: { type: "pageNumber" } as never,
          },
        }),
    ).toThrow();
  });

  it("skips validation when validate: false", () => {
    expect(
      () =>
        new PaginatedClient({
          baseUrl: "https://api.example.com",
          schemes: {
            bad: { type: "pageNumber" } as never,
          },
          validate: false,
          fetcher: async () => ({ body: {}, headers: {} }),
        }),
    ).not.toThrow();
  });

  it("throws when fetching an unknown scheme", async () => {
    const client = new PaginatedClient({
      baseUrl: "https://api.example.com",
      schemes,
      fetcher: async () => ({ body: {}, headers: {} }),
    });
    let threw = false;
    try {
      await client.fetchPage("/items", "nonExistent");
    } catch {
      threw = true;
    }
    expect(threw).toBeTrue();
  });
});

// ---------------------------------------------------------------------------
// fetchPage — pageNumber
// ---------------------------------------------------------------------------

describe("PaginatedClient.fetchPage — pageNumber", () => {
  it("fetches the first page and returns items + pagination state", async () => {
    const { fetcher, calls } = makeMockFetcher([
      {
        body: {
          items: [makeProduct(1), makeProduct(2)],
          currentPage: 1,
          total: 10,
          totalPages: 5,
        },
      },
    ]);

    const client = new PaginatedClient({
      baseUrl: "https://api.example.com",
      schemes,
      fetcher,
    });

    const page = await client.fetchPage<{ id: number }>(
      "/products",
      "pageNumber",
    );

    expect(page.items).toHaveLength(2);
    expect(page.items[0]!.id).toBe(1);
    expect(page.pagination.currentPage).toBe(1);
    expect(page.pagination.totalPages).toBe(5);
    expect(page.pagination.hasNextPage).toBeTrue();
    expect(calls).toHaveLength(1);

    const calledUrl = new URL(calls[0]!.url);
    expect(calledUrl.searchParams.get("page")).toBe("1");
  });

  it("includes the default page size when configured", async () => {
    const { fetcher, calls } = makeMockFetcher([
      { body: { items: [], currentPage: 1, total: 0, totalPages: 0 } },
    ]);

    const client = new PaginatedClient({
      baseUrl: "https://api.example.com",
      schemes,
      fetcher,
      defaultPageSize: 25,
    });

    await client.fetchPage("/products", "pageNumber");
    const calledUrl = new URL(calls[0]!.url);
    expect(calledUrl.searchParams.get("limit")).toBe("25");
  });

  it("uses provided nextPageParams on subsequent calls", async () => {
    const { fetcher, calls } = makeMockFetcher([
      { body: { items: [makeProduct(3)], currentPage: 2, total: 10, totalPages: 5 } },
    ]);

    const client = new PaginatedClient({
      baseUrl: "https://api.example.com",
      schemes,
      fetcher,
    });

    const nextParams: PaginationRequestParams = {
      queryParameters: { page: 2, limit: 20 },
      bodyFields: {},
      headerFields: {},
    };

    await client.fetchPage("/products", "pageNumber", nextParams);
    const calledUrl = new URL(calls[0]!.url);
    expect(calledUrl.searchParams.get("page")).toBe("2");
  });

  it("extracts items from a 'data' key when no 'items' key present", async () => {
    const { fetcher } = makeMockFetcher([
      {
        body: {
          data: [makeProduct(1)],
          currentPage: 1,
          total: 1,
          totalPages: 1,
        },
      },
    ]);
    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });
    const page = await client.fetchPage<{ id: number }>("/products", "pageNumber");
    expect(page.items).toHaveLength(1);
  });

  it("uses itemsField option when provided", async () => {
    const { fetcher } = makeMockFetcher([
      {
        body: {
          records: [makeProduct(1), makeProduct(2)],
          currentPage: 1,
          total: 2,
          totalPages: 1,
        },
      },
    ]);
    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });
    const page = await client.fetchPage<{ id: number }>("/products", "pageNumber", null, {
      itemsField: "records",
    });
    expect(page.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// fetchPage — pageToken
// ---------------------------------------------------------------------------

describe("PaginatedClient.fetchPage — pageToken", () => {
  it("does not send a token on the first page", async () => {
    const { fetcher, calls } = makeMockFetcher([
      { body: { items: [], nextPageToken: "tok1" } },
    ]);
    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });
    await client.fetchPage("/events", "pageToken");
    const calledUrl = new URL(calls[0]!.url);
    expect(calledUrl.searchParams.has("pageToken")).toBeFalse();
  });

  it("extracts nextPageToken and sets hasNextPage", async () => {
    const { fetcher } = makeMockFetcher([
      { body: { items: [makeProduct(1)], nextPageToken: "tok_abc" } },
    ]);
    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });
    const page = await client.fetchPage<{ id: number }>("/events", "pageToken");
    expect(page.pagination.nextPageToken).toBe("tok_abc");
    expect(page.pagination.hasNextPage).toBeTrue();
    expect(page.nextPageParams?.queryParameters["pageToken"]).toBe("tok_abc");
  });

  it("hasNextPage is false when nextPageToken is null", async () => {
    const { fetcher } = makeMockFetcher([
      { body: { items: [], nextPageToken: null } },
    ]);
    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });
    const page = await client.fetchPage("/events", "pageToken");
    expect(page.pagination.hasNextPage).toBeFalse();
    expect(page.nextPageParams).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchPage — nextLink
// ---------------------------------------------------------------------------

describe("PaginatedClient.fetchPage — nextLink", () => {
  it("follows the next URL from the Link header", async () => {
    const { fetcher, calls } = makeMockFetcher([
      {
        body: { items: [makeProduct(1)] },
        headers: {
          Link: '<https://api.example.com/items?page=2>; rel="next"',
        },
      },
      {
        body: { items: [makeProduct(2)] },
        headers: {},
      },
    ]);

    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });

    // Page 1
    const page1 = await client.fetchPage<{ id: number }>("/items", "nextLink");
    expect(page1.pagination.nextLink).toBe("https://api.example.com/items?page=2");
    expect(page1.pagination.hasNextPage).toBeTrue();

    // Page 2 — use the nextLink URL
    const page2 = await client.fetchPage<{ id: number }>(
      "/items",
      "nextLink",
      page1.nextPageParams,
      { nextUrl: page1.pagination.nextLink! },
    );
    expect(page2.items[0]!.id).toBe(2);
    expect(new URL(calls[1]!.url).pathname).toBe("/items");
    expect(new URL(calls[1]!.url).searchParams.get("page")).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// pages() async generator
// ---------------------------------------------------------------------------

describe("PaginatedClient.pages() — pageNumber", () => {
  it("iterates all pages and stops when hasNextPage is false", async () => {
    const mockPages: MockPage[] = [
      { body: { items: [makeProduct(1), makeProduct(2)], currentPage: 1, total: 6, totalPages: 3 } },
      { body: { items: [makeProduct(3), makeProduct(4)], currentPage: 2, total: 6, totalPages: 3 } },
      { body: { items: [makeProduct(5), makeProduct(6)], currentPage: 3, total: 6, totalPages: 3 } },
    ];

    const { fetcher, calls } = makeMockFetcher(mockPages);
    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });

    const pagesSeen: number[] = [];
    for await (const page of client.pages<{ id: number }>("/products", "pageNumber")) {
      pagesSeen.push(page.pagination.currentPage!);
    }

    expect(pagesSeen).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(3);
  });

  it("increments page number on each request", async () => {
    const mockPages: MockPage[] = [
      { body: { items: [makeProduct(1)], currentPage: 1, total: 3, totalPages: 3 } },
      { body: { items: [makeProduct(2)], currentPage: 2, total: 3, totalPages: 3 } },
      { body: { items: [makeProduct(3)], currentPage: 3, total: 3, totalPages: 3 } },
    ];
    const { fetcher, calls } = makeMockFetcher(mockPages);
    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });

    for await (const _ of client.pages("/products", "pageNumber")) { /* consume */ }

    expect(new URL(calls[0]!.url).searchParams.get("page")).toBe("1");
    expect(new URL(calls[1]!.url).searchParams.get("page")).toBe("2");
    expect(new URL(calls[2]!.url).searchParams.get("page")).toBe("3");
  });
});

describe("PaginatedClient.pages() — pageToken", () => {
  it("threads tokens through consecutive requests", async () => {
    const mockPages: MockPage[] = [
      { body: { items: [makeProduct(1)], nextPageToken: "tok1" } },
      { body: { items: [makeProduct(2)], nextPageToken: "tok2" } },
      { body: { items: [makeProduct(3)], nextPageToken: null } },
    ];
    const { fetcher, calls } = makeMockFetcher(mockPages);
    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });

    const allItems: number[] = [];
    for await (const page of client.pages<{ id: number }>("/events", "pageToken")) {
      allItems.push(...page.items.map((i) => i.id));
    }

    expect(allItems).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(3);

    // First call: no token
    expect(new URL(calls[0]!.url).searchParams.has("pageToken")).toBeFalse();
    // Second call: token from page 1
    expect(new URL(calls[1]!.url).searchParams.get("pageToken")).toBe("tok1");
    // Third call: token from page 2
    expect(new URL(calls[2]!.url).searchParams.get("pageToken")).toBe("tok2");
  });
});

describe("PaginatedClient.pages() — nextLink", () => {
  it("follows Link headers across all pages", async () => {
    const mockPages: MockPage[] = [
      {
        body: { items: [makeProduct(1)] },
        headers: { Link: '<https://api.example.com/items?page=2>; rel="next"' },
      },
      {
        body: { items: [makeProduct(2)] },
        headers: { Link: '<https://api.example.com/items?page=3>; rel="next"' },
      },
      {
        body: { items: [makeProduct(3)] },
        headers: {},
      },
    ];

    const { fetcher, calls } = makeMockFetcher(mockPages);
    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });

    const allItems: number[] = [];
    for await (const page of client.pages<{ id: number }>("/items", "nextLink")) {
      allItems.push(...page.items.map((i) => i.id));
    }

    expect(allItems).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(3);
    // Second and third calls use the Link URL
    expect(new URL(calls[1]!.url).searchParams.get("page")).toBe("2");
    expect(new URL(calls[2]!.url).searchParams.get("page")).toBe("3");
  });
});

// ---------------------------------------------------------------------------
// collectAll()
// ---------------------------------------------------------------------------

describe("PaginatedClient.collectAll()", () => {
  it("collects all items from all pages into a flat array", async () => {
    const mockPages: MockPage[] = [
      { body: { items: [makeProduct(1), makeProduct(2)], currentPage: 1, total: 6, totalPages: 3 } },
      { body: { items: [makeProduct(3), makeProduct(4)], currentPage: 2, total: 6, totalPages: 3 } },
      { body: { items: [makeProduct(5), makeProduct(6)], currentPage: 3, total: 6, totalPages: 3 } },
    ];

    const { fetcher } = makeMockFetcher(mockPages);
    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });

    const all = await client.collectAll<{ id: number }>("/products", "pageNumber");
    expect(all).toHaveLength(6);
    expect(all.map((p) => p.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("returns empty array for empty first page", async () => {
    const { fetcher } = makeMockFetcher([
      { body: { items: [], currentPage: 1, total: 0, totalPages: 0 } },
    ]);
    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });
    const all = await client.collectAll("/products", "pageNumber");
    expect(all).toHaveLength(0);
  });

  it("returns a single page when there is no next page", async () => {
    const { fetcher } = makeMockFetcher([
      { body: { items: [makeProduct(1)], currentPage: 1, total: 1, totalPages: 1 } },
    ]);
    const client = new PaginatedClient({ baseUrl: "https://api.example.com", schemes, fetcher });
    const all = await client.collectAll<{ id: number }>("/products", "pageNumber");
    expect(all).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Auto-detection integration
// ---------------------------------------------------------------------------

describe("PaginatedClient.detectSchemesForOperation()", () => {
  it("detects pageNumber scheme from operation query params", () => {
    const client = new PaginatedClient({
      baseUrl: "https://api.example.com",
      schemes,
      fetcher: async () => ({ body: {}, headers: {} }),
    });
    const detected = client.detectSchemesForOperation({
      queryParams: ["page", "limit", "q"],
    });
    expect(detected).toContain("pageNumber");
  });

  it("detects pageToken scheme", () => {
    const client = new PaginatedClient({
      baseUrl: "https://api.example.com",
      schemes,
      fetcher: async () => ({ body: {}, headers: {} }),
    });
    const detected = client.detectSchemesForOperation({
      queryParams: ["pageToken", "pageSize"],
    });
    expect(detected).toContain("pageToken");
  });

  it("returns empty when no query params match any scheme", () => {
    const client = new PaginatedClient({
      baseUrl: "https://api.example.com",
      schemes,
      fetcher: async () => ({ body: {}, headers: {} }),
    });
    const detected = client.detectSchemesForOperation({
      queryParams: ["q", "sort", "filter"],
    });
    expect(detected).toHaveLength(0);
  });
});
