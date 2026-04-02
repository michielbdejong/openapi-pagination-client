# @openapi-pagination/client

An API client library that implements the [OpenAPI Pagination Extension](https://github.com/michielbdejong/openapi-pagination-client) (`paginationSchemes`). It handles all three pagination scheme types — **pageNumber**, **pageToken**, and **nextLink** — driven entirely by the scheme definitions in your OpenAPI document.

## Installation

```sh
npm install @openapi-pagination/client
```

## Quickstart

```ts
import { PaginatedClient } from "@openapi-pagination/client";

const client = new PaginatedClient({
  baseUrl: "https://api.example.com",
  schemes: {
    pageNumber: {
      type: "pageNumber",
      request: {
        queryParameters: {
          page:  { role: "page" },
          limit: { role: "pageSize" },
        },
      },
      response: {
        bodyFields: {
          total:      { role: "totalCount" },
          totalPages: { role: "totalPages" },
          page:       { role: "currentPage" },
        },
      },
    },
  },
});

// Fetch a single page
const page = await client.fetchPage<Product>("/products", "pageNumber");
console.log(page.items);          // Product[]
console.log(page.pagination);     // PaginationResponseState
console.log(page.nextPageParams); // params to pass to the next fetchPage call

// Iterate over all pages
for await (const page of client.pages<Product>("/products", "pageNumber")) {
  process(page.items);
}

// Collect everything into one array (caution: buffers all pages in memory)
const all = await client.collectAll<Product>("/products", "pageNumber");
```

## Pagination scheme types

### pageNumber

Page-number-based pagination. The scheme declares which query (or body) parameter carries the page number and which carries the page size, and which response fields carry `totalCount`, `totalPages`, and `currentPage`.

### pageToken

Opaque-token / cursor-based pagination. The server returns a `nextPageToken` (or `nextCursor`) in the response body; the client sends it back on the next request.

### nextLink

Hypermedia-style pagination. The server returns the full URL of the next page either as a `Link: <url>; rel="next"` response header or as a body field. The client follows the URL directly.

## `PaginatedClient` API

### Constructor

```ts
new PaginatedClient(options: PaginatedClientOptions)
```

| Option | Type | Description |
|---|---|---|
| `baseUrl` | `string` | Base URL prepended to all relative paths. |
| `schemes` | `PaginationSchemesMap` | The `paginationSchemes` map from your OpenAPI document. |
| `fetcher` | `Fetcher` (optional) | Custom HTTP function. Defaults to `globalThis.fetch`. Useful for injecting mocks in tests. |
| `defaultPageSize` | `number` (optional) | Page size injected when the scheme supports it. |
| `validate` | `boolean` (optional, default `true`) | Validate schemes against the spec on construction. |

### `fetchPage<T>(path, schemeName, params?, options?)`

Fetches a single page. Pass `null`/`undefined` for `params` to fetch the first page, or pass `page.nextPageParams` from a previous result to advance.

### `pages<T>(path, schemeName, options?)`

Async generator that yields one `Page<T>` per server response until `hasNextPage` is `false`.

### `collectAll<T>(path, schemeName, options?)`

Fetches all pages and returns a flat `T[]`. Use with care on large data sets.

### `detectSchemesForOperation(operation)`

Returns the scheme names that would auto-match a given `OperationDescriptor` (useful for tooling).

## Lower-level exports

The library also exports the building blocks used internally:

| Export | Description |
|---|---|
| `validateScheme` / `validateSchemesMap` | Validate scheme objects against the spec. Throws `PaginationValidationError`. |
| `schemeMatchesOperation` / `detectSchemes` | Auto-detection logic (§6). |
| `mergeSchemeOverrides` / `resolveEffectiveSchemes` | Override merging (§5). |
| `buildFirstPageParams` / `buildNextPageParams` | Build `PaginationRequestParams` from a scheme. |
| `applyParamsToRequest` | Apply params to a URL + headers. |
| `parseResponse` / `parseLinkHeader` / `buildNextFromState` | Parse a server response into `PaginationResponseState`. |

## Types

All public types are re-exported from the package root:

```ts
import type {
  PaginationSchemeObject,
  PaginationSchemesMap,
  PaginationRequestParams,
  PaginationResponseState,
  Page,
  OperationDescriptor,
  // ...
} from "@openapi-pagination/client";
```

## Development

```sh
npm install
npm test          # run tests with coverage
npm run build     # compile to dist/
```

Tests are written in TypeScript and run with [Jest](https://jestjs.io/) via `ts-jest`. CI runs on every push via GitHub Actions.
