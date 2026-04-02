# CLAUDE.md

## Project overview

`@openapi-pagination/client` is a TypeScript library that implements the OpenAPI Pagination Extension (`paginationSchemes`). It handles pageNumber, pageToken, and nextLink pagination schemes driven by OpenAPI document definitions.

## Repository layout

```
src/
  types.ts           # All public TypeScript types (mirrors spec objects 1:1)
  validation.ts      # Spec conformance validation; throws PaginationValidationError
  autodetect.ts      # Auto-detection and override resolution (spec §5–6)
  request-builder.ts # Builds PaginationRequestParams from a scheme
  response-parser.ts # Extracts PaginationResponseState from a server response
  client.ts          # High-level PaginatedClient (fetchPage / pages / collectAll)
  index.ts           # Public re-exports

tests/
  harness.ts         # Jest compatibility shim (re-exports describe/it/expect, adds toBeTrue/toBeFalse)
  *.test.ts          # One test file per source module
```

## Commands

```sh
npm install   # install dependencies
npm test      # run all tests with coverage (jest --coverage)
npm run build # compile TypeScript to dist/
```

## Testing

- Tests use Jest via `ts-jest`.
- `jest.config.js` includes `moduleNameMapper: { '^(.*)\\.js$': '$1' }` to resolve TypeScript-style `.js` imports.
- `tests/harness.ts` re-exports Jest's `describe`/`it`/`expect` and registers `toBeTrue()`/`toBeFalse()` via `expect.extend()`. All test files import from `./harness.js` — do not replace those imports with direct Jest globals.
- CI runs `npm test` on every push and pull request (`.github/workflows/ci.yml`).

## Code conventions

- All source imports use `.js` extensions (TypeScript ESM style), even though the compiled output targets CommonJS (`"module": "commonjs"` in `tsconfig.json`). The jest `moduleNameMapper` strips the extension at test time.
- Types in `src/types.ts` mirror the spec field names verbatim — do not rename them for stylistic reasons.
- `PaginationValidationError` carries a `path` field (`paginationSchemes.<name>`) for precise error reporting.
- The three scheme types (`pageNumber`, `pageToken`, `nextLink`) each have distinct logic in request-builder, response-parser, and client; keep their `switch` branches in sync when making changes.

## Branch

Active development branch: `claude/fix-npm-tests-8OwRC` (merged to `main`).
