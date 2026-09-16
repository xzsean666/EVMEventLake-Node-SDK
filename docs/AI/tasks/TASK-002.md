# TASK-002: Universal Packaging and Native Storage Driver Decoupling

## Objective
Decouple static Node native driver imports (`better-sqlite3`, `pg`) from the client façade and storage factory, add support for `idb://` and `indexeddb://` connection schemes in configuration validation, and ensure the package compiles and bundles cleanly for both browser environments and Node.js runtimes.

## Scope
- Expand `DatabaseConfiguration` in `src/configuration/sdk-options.ts` to include `IndexeddbDatabaseConfiguration` (`kind: "indexeddb"`, `databaseName: string`).
- Update `src/configuration/validate-sdk-options.ts` to parse and validate `idb://<databaseName>` and `indexeddb://<databaseName>`.
- Decouple `src/storage/create-storage-adapter.ts` and `src/client/evm-event-lake.ts` from static imports of `better-sqlite3` and `pg`. Load native SQLite/PostgreSQL adapters dynamically/lazily only when requested, or provide pluggable factory resolution.
- Ensure browser bundlers (Vite, Webpack, Rollup) can bundle `@evm-event-lake/node-sdk` without encountering missing native module errors.
- Add unit tests verifying `idb://` configuration parsing and error handling for malformed URLs.

## Allowed Files
- `src/configuration/sdk-options.ts`
- `src/configuration/validate-sdk-options.ts`
- `src/storage/create-storage-adapter.ts`
- `src/client/evm-event-lake.ts`
- `tests/unit/configuration/validate-sdk-options.test.ts`
- `package.json`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-002.md`

## Dependencies
- TASK-001 (EVM Infrastructure Migration: Rebase on evm-call).

## Inputs and Outputs
- **Inputs**: Options with `database: "idb://my-dapp-db"` or `"indexeddb://my-dapp-db"`.
- **Outputs**: Validated normalized options supporting IndexedDB, clean bundler compilation without Node native C++ dependencies in the browser path.

## Acceptance Criteria
- [x] `validateSdkOptions` parses `idb://<databaseName>` and `indexeddb://<databaseName>` into `{ kind: "indexeddb", databaseName: "<databaseName>" }`.
- [x] Static imports of `better-sqlite3` and `pg` are removed from the client entrypoint / facade import graph.
- [x] TypeScript builds declarations and ESM output without errors (`pnpm run build`).
- [x] Unit tests verify IndexedDB URL normalization and invalid scheme rejection.

## Verification Commands
```bash
pnpm run typecheck
pnpm run test:unit
pnpm run build
```

## Risks and Assumptions
- Must ensure existing SQLite and PostgreSQL backend workflows continue to work without breaking changes.
- Dynamic driver loading must preserve exact error reporting if a required native driver is missing in Node.

## Status
DONE
